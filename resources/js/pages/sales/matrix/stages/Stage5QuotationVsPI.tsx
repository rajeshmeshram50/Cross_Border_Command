import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import {
  CreateQuotationModal,
  CreatePIModal,
  type QpiInitialOpp,
  type Quotation as QpiQuotation,
} from '../../SalesQPI';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 5: Quotation vs PI
 *
 *  Lists every Quotation and Proforma Invoice attached to the current
 *  lead (filtered server-side via ?opp_id={leadId}). Per-row inline
 *  actions: View PDF · Download PDF · Convert to PI · Email.
 *
 *  The full 2-step Create Quotation / Create PI wizard from the SalesQPI
 *  workspace is lifted into Stage 5 via the exported modal components —
 *  the lead context (opp, customer, consignee) is pre-fed so users don't
 *  have to re-pick the opportunity. Clicking a row code re-opens the
 *  same modal in edit mode.
 *
 *  Save & Next persists lead_stage_id=6 (advances to Victory Stage).
 * ───────────────────────────────────────────────────────────────────── */

type DocType = 'quotation' | 'pi';

type QuotationRow = {
  id:             number;
  code:           string | null;
  opp_id:         number | null;
  opp_code:       string | null;
  customer:       { id: number; customer_code: string | null; company_name: string | null } | null;
  consignee:      { id: number; consignee_code: string | null; company_name: string | null } | null;
  /* G1: backend column is `doc_type` not `document_type` — earlier
   *  shape always rendered "—" in the Doc Type column. */
  doc_type:       string | null;
  currency:       string | null;
  grand_total:    number | string | null;
  status:         string | null;
  created_at:     string;
  /* G8: included so "Latest" reflects edits, not just inserts. */
  updated_at?:    string;
};

type PIRow = {
  id:                     number;
  code:                   string | null;
  opp_id:                 number | null;
  opp_code:               string | null;
  source_quotation_id:    number | null;
  customer:               { id: number; customer_code: string | null; company_name: string | null } | null;
  consignee:              { id: number; consignee_code: string | null; company_name: string | null } | null;
  doc_type:               string | null;
  currency:               string | null;
  grand_total:            number | string | null;
  status:                 string | null;
  created_at:             string;
  updated_at?:            string;
};

const fmtDate = (s: string | null): string => {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
};

const fmtMoney = (v: number | string | null, ccy: string | null): string => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  return `${ccy ?? ''} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
};

const statusClass = (s: string | null): string => {
  const lc = (s ?? '').toLowerCase();
  if (lc === 'draft')     return 's5-status-draft';
  if (lc === 'sent')      return 's5-status-sent';
  if (lc === 'approved')  return 's5-status-approved';
  if (lc === 'cancelled') return 's5-status-cancelled';
  if (lc === 'converted') return 's5-status-converted';
  return 's5-status-default';
};

export default function Stage5QuotationVsPI({ header, onPrev, onNext, reloadLead, onPiChange }: StageProps) {
  const toast = useToast();
  const leadId = header.leadId ?? null;

  const [docType, setDocType]   = useState<DocType>('quotation');
  const [loading, setLoading]   = useState(false);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [pis, setPis]           = useState<PIRow[]>([]);
  const [actingId, setActingId] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);

  /* Inline create / edit modal state. The modals themselves live in the
   * SalesQPI workspace — we lift them here so the user gets the same
   * 2-step wizard inside the matrix detail without leaving the lead. */
  const [createQtOpen, setCreateQtOpen]     = useState(false);
  const [createPiOpen, setCreatePiOpen]     = useState(false);
  const [editQtId, setEditQtId]             = useState<number | null>(null);
  const [editPiId, setEditPiId]             = useState<number | null>(null);
  const [piSource, setPiSource]             = useState<QpiQuotation | null>(null);

  /* Lead context fed into both modals so the Opportunity dropdown is
   * pre-filled (customer + consignee labels too). The modals still
   * cascade-fetch the remaining masters. */
  const initialOpp: QpiInitialOpp | undefined = useMemo(() => {
    if (!leadId) return undefined;
    return {
      oppId:           leadId,
      oppCode:         header.oppId,
      oppDate:         header.oppDate,
      customerLabel:   header.customer,
      consigneeLabel:  (header.consigneeRow as Record<string, unknown> | null | undefined)?.company_name as string | undefined,
    };
  }, [leadId, header.oppId, header.oppDate, header.customer, header.consigneeRow]);

  const fetchAll = useCallback(async (silent = false) => {
    if (!leadId) return;
    if (!silent) setLoading(true);
    const [qRes, pRes] = await Promise.allSettled([
      api.get<{ status: boolean; data: QuotationRow[] }>('/sales/quotations', { params: { opp_id: leadId, per_page: 200 } }),
      api.get<{ status: boolean; data: PIRow[] }>('/sales/proforma-invoices', { params: { opp_id: leadId, per_page: 200 } }),
    ]);
    if (qRes.status === 'fulfilled') setQuotations(qRes.value.data.data ?? []);
    else toast.error('Load failed', 'Could not load quotations for this opportunity.');
    if (pRes.status === 'fulfilled') setPis(pRes.value.data.data ?? []);
    else toast.error('Load failed', 'Could not load proforma invoices for this opportunity.');
    if (!silent) setLoading(false);
  }, [leadId, toast]);

  useEffect(() => { void fetchAll(false); }, [fetchAll]);

  /* ── Per-row actions ─────────────────────────────────────────────── */
  const onViewPdf = async (kind: DocType, id: number) => {
    setActingId(id);
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
      const res = await api.post(url, { signature: false }, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch {
      toast.error('Preview failed', 'Could not open the PDF preview.');
    } finally {
      setActingId(null);
    }
  };

  const onDownloadPdf = async (kind: DocType, id: number, code: string | null) => {
    setActingId(id);
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
      const res = await api.post(url, { signature: false }, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${(code ?? `${kind}-${id}`).replace(/[^a-z0-9\-_.]/gi, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('Download failed', 'Could not download the PDF.');
    } finally {
      setActingId(null);
    }
  };

  const onConvertToPi = async (q: QuotationRow) => {
    if (!q.id) return;
    setActingId(q.id);
    try {
      const { data } = await api.post<{ status: boolean; data?: { code?: string } }>(
        `/sales/proforma-invoices/from-quotation/${q.id}`,
      );
      const code = data?.data?.code ?? 'PI';
      /* G4: refetch FIRST, then flip the tab. If we flip first the
       *  user sees the PI tab momentarily empty before the new row
       *  paints; refetch-then-switch lands them on the populated PI
       *  list immediately. */
      await fetchAll(true);
      setDocType('pi');
      toast.success('Converted to PI', `New proforma invoice ${code} created from ${q.code ?? 'this quotation'}.`);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      // The PI controller blocks duplicate PIs per opportunity — surface
      // that clearly so users know to edit the existing PI instead.
      toast.error('Conversion blocked', msg ?? 'Could not convert this quotation to a PI.');
    } finally {
      setActingId(null);
    }
  };

  const onEmail = async (kind: DocType, id: number, code: string | null) => {
    setActingId(id);
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/email` : `/sales/proforma-invoices/${id}/email`;
      await api.post(url, {});
      toast.success('Email sent', `${code ?? 'Document'} was emailed to the customer.`);
    } catch (e: any) {
      toast.error('Email failed', e?.response?.data?.message ?? 'Could not send the email — check the customer contact details.');
    } finally {
      setActingId(null);
    }
  };

  /* ── Create — opens the SalesQPI workspace modals INLINE with the
   * current lead context pre-filled. No page navigation, no re-pick of
   * the opportunity dropdown. */
  const onCreate = (kind: DocType) => {
    if (!leadId) {
      toast.warning('Open from worksheet', 'Re-enter this stage from the Lead Worksheet to attach a quotation.');
      return;
    }
    if (kind === 'quotation') { setEditQtId(null); setCreateQtOpen(true); }
    else                      { setPiSource(null); setEditPiId(null); setCreatePiOpen(true); }
  };

  const onEdit = (kind: DocType, id: number) => {
    if (kind === 'quotation') { setEditQtId(id); setCreateQtOpen(true); }
    else                      { setEditPiId(id); setPiSource(null); setCreatePiOpen(true); }
  };

  /* ── Save & Next → advance to Stage 6 ────────────────────────────── */
  const onSaveAndNext = async () => {
    if (!leadId) {
      toast.warning('Open from worksheet', 'Re-enter this stage from the Lead Worksheet to save your progress.');
      return;
    }
    /* G7: live = not-cancelled. A lead whose only quotations/PIs are
     *  cancelled has nothing to advance with — the cancelled rows
     *  represent rejected deals, not progress. */
    if (liveQuotationsCount === 0 && livePisCount === 0) {
      toast.warning('Create a quotation or PI first', 'Stage 5 needs at least one active quotation or proforma invoice before advancing.');
      return;
    }
    setAdvancing(true);
    try {
      await api.put(`/sales/leads/${leadId}`, { lead_stage_id: 6 });
      toast.success('Stage advanced', 'Moving to Victory Stage (Stage 6)…');
      reloadLead?.();
      onNext();
    } catch (e: any) {
      toast.error('Could not advance', e?.response?.data?.message ?? 'Network or server error — please try again.');
    } finally {
      setAdvancing(false);
    }
  };

  /* ── Derived ───────────────────────────────────────────────────── */
  const rows = docType === 'quotation' ? quotations : pis;

  /* G6: previously each row checked `actingId === r.id` to disable
   *  its own buttons only — so clicking on row 1 (action in flight)
   *  then clicking on row 2 reassigned actingId to row 2, silently
   *  re-enabling row 1's buttons mid-flight. Now a single page-wide
   *  flag locks every action button while ANY row is in flight,
   *  killing the race and matching the user expectation of "I just
   *  clicked something, the page is busy". */
  const anyActing = actingId !== null;

  /* G2: group totals by currency so a mix of INR + USD doesn't get
   *  summed under a single (and wrong) currency label. Result shape:
   *  Map<currency, sum>. The render picks the unique currency when
   *  exactly one is present, otherwise shows "Mixed". */
  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const n = Number(r.grand_total);
      if (!Number.isFinite(n)) continue;
      const ccy = (r.currency ?? '').toUpperCase() || '—';
      map.set(ccy, (map.get(ccy) ?? 0) + n);
    }
    return map;
  }, [rows]);

  /* G8: "Latest" reflects the most recently TOUCHED row, not the
   *  highest-id one. Falls back to created_at when updated_at is
   *  missing (older rows pre-dating the API exposing updated_at). */
  const latestTimestamp = useMemo(() => {
    let best: string | null = null;
    let bestMs = -Infinity;
    for (const r of rows) {
      const ts = r.updated_at ?? r.created_at;
      const ms = ts ? new Date(ts).getTime() : NaN;
      if (Number.isFinite(ms) && ms > bestMs) { bestMs = ms; best = ts; }
    }
    return best;
  }, [rows]);

  /* G7: Save & Next blocks when there's no LIVE (non-cancelled) doc
   *  on the lead. Counting `length` alone let an all-cancelled lead
   *  advance to Stage 6 with nothing of substance to show. */
  const liveQuotationsCount = useMemo(
    () => quotations.filter(q => (q.status ?? '').toLowerCase() !== 'cancelled').length,
    [quotations],
  );
  const livePisCount = useMemo(
    () => pis.filter(p => (p.status ?? '').toLowerCase() !== 'cancelled').length,
    [pis],
  );

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE5_CSS}</style>

      <div className="smd-stg-head smd-s5-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 5: Quotation vs PI</div>
            <div className="smd-stg-head-sub">● Quotation / Proforma Invoice comparison</div>
          </div>
        </div>
        <span className="smd-stg-head-badge">● ACTIVE</span>
      </div>

      <div className="smd-stg-body">
        {/* Tab + Create row */}
        <div className="s5-tab-row">
          <div className="s5-tabs">
            <button
              type="button"
              className={`s5-tab s5-tab-q ${docType === 'quotation' ? 'active' : ''}`}
              onClick={() => setDocType('quotation')}
            >
              <span className="s5-tab-ico">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                </svg>
              </span>
              Quotation
              <span className="s5-tab-count">{quotations.length}</span>
            </button>
            <button
              type="button"
              className={`s5-tab s5-tab-p ${docType === 'pi' ? 'active' : ''}`}
              onClick={() => setDocType('pi')}
            >
              <span className="s5-tab-ico">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                </svg>
              </span>
              Proforma Invoice
              <span className="s5-tab-count">{pis.length}</span>
            </button>
          </div>
          <div className="s5-create-row">
            <button type="button" className="s5-create-btn s5-create-q" onClick={() => onCreate('quotation')}>
              + Create Quotation
            </button>
            <button type="button" className="s5-create-btn s5-create-p" onClick={() => onCreate('pi')}>
              + Create PI
            </button>
          </div>
        </div>

        {/* Summary band */}
        <div className="s5-summary smd-fade-in" key={`sum-${docType}`}>
          <div className="s5-summary-cell">
            <span className="s5-summary-label">{docType === 'quotation' ? 'Total Quotations' : 'Total Proforma Invoices'}</span>
            <span className="s5-summary-val">{loading ? <span className="smd-skel smd-skel-num" /> : rows.length}</span>
          </div>
          <div className="s5-summary-cell">
            <span className="s5-summary-label">Combined Value</span>
            <span className="s5-summary-val">{loading ? <span className="smd-skel" style={{ maxWidth: 110 }} /> : (() => {
              /* G2: when the rows share a single currency, render the
               *  sum with that currency. When two or more currencies
               *  are mixed, render each total on its own line + a
               *  "Mixed" label so the user isn't misled by a single
               *  number that adds INR + USD together. */
              if (totalsByCurrency.size === 0) return '—';
              if (totalsByCurrency.size === 1) {
                const [ccy, sum] = totalsByCurrency.entries().next().value as [string, number];
                return fmtMoney(sum, ccy);
              }
              return (
                <span className="s5-summary-mixed" title="Multiple currencies in use — totals shown per currency">
                  {Array.from(totalsByCurrency.entries()).map(([ccy, sum]) => (
                    <span key={ccy} className="s5-summary-mixed-row">{fmtMoney(sum, ccy)}</span>
                  ))}
                </span>
              );
            })()}</span>
          </div>
          <div className="s5-summary-cell">
            <span className="s5-summary-label">Latest</span>
            <span className="s5-summary-val">{loading ? <span className="smd-skel" style={{ maxWidth: 110 }} /> : fmtDate(latestTimestamp)}</span>
          </div>
        </div>

        {/* Table */}
        <div className="s5-card smd-fade-in" key={docType}>
          <div className="s5-card-head">
            <div className="s5-card-head-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </div>
            <div>
              <div className="s5-card-title">
                {docType === 'quotation' ? 'Quotations on this Opportunity' : 'Proforma Invoices on this Opportunity'}
              </div>
              <div className="s5-card-sub">
                {docType === 'quotation'
                  ? 'Convert a quotation into a PI when the customer confirms.'
                  : 'One PI per opportunity. Already converted? Edit the existing PI.'}
              </div>
            </div>
          </div>

          <div className="s5-table-wrap">
            <table className="s5-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>Sr No</th>
                  <th style={{ width: 150 }}>{docType === 'quotation' ? 'Quotation No' : 'PI No'}</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th>Customer</th>
                  <th style={{ width: 110 }}>Doc Type</th>
                  <th style={{ width: 70 }}>Currency</th>
                  <th style={{ width: 140 }}>Value</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 170 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="smd-fade-in">
                    <td><span className="smd-skel smd-skel-num" /></td>
                    <td><span className="smd-skel smd-skel-chip" /></td>
                    <td><span className="smd-skel" style={{ maxWidth: 80 }} /></td>
                    <td><span className="smd-skel smd-skel-name" /></td>
                    <td><span className="smd-skel smd-skel-pill" /></td>
                    <td><span className="smd-skel smd-skel-chip" /></td>
                    <td><span className="smd-skel smd-skel-num" /></td>
                    <td><span className="smd-skel smd-skel-pill" /></td>
                    <td><span className="smd-skel smd-skel-btn" /></td>
                  </tr>
                ))}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="s5-empty">
                      {docType === 'quotation'
                        ? 'No quotations on this opportunity yet — click "+ Create Quotation" to start.'
                        : 'No proforma invoices yet. Convert a quotation to PI, or click "+ Create PI".'}
                    </td>
                  </tr>
                )}

                {!loading && rows.map((r, idx) => (
                  <tr key={r.id} className={anyActing && actingId === r.id ? 's5-row-acting' : undefined}>
                    <td><span className="s5-sr">{idx + 1}</span></td>
                    <td>
                      {/* G5: if the code is missing, show the row id as
                       *  a stable fallback so the user knows what they
                       *  would be editing. Button stays clickable since
                       *  edit still works by id. */}
                      <button
                        type="button"
                        className="s5-code s5-code-link"
                        onClick={() => onEdit(docType, r.id)}
                        title={r.code ? 'Edit this document' : `Edit document #${r.id} (no code assigned)`}
                        disabled={anyActing}
                      >
                        {r.code ?? `#${r.id}`}
                      </button>
                    </td>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>
                      <div className="s5-cust">
                        <span className="s5-cust-name">{r.customer?.company_name ?? '—'}</span>
                        {r.customer?.customer_code && <span className="s5-cust-code">{r.customer.customer_code}</span>}
                      </div>
                    </td>
                    <td><span className="s5-doctype">{r.doc_type ?? '—'}</span></td>
                    <td><span className="s5-ccy">{r.currency ?? '—'}</span></td>
                    <td className="s5-value">{fmtMoney(r.grand_total, r.currency)}</td>
                    <td><span className={`s5-status ${statusClass(r.status)}`}>{r.status ?? '—'}</span></td>
                    <td>
                      <div className="s5-actions">
                        <button
                          type="button" className="s5-act-btn" title="View PDF"
                          onClick={() => void onViewPdf(docType, r.id)}
                          disabled={anyActing}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                        </button>
                        <button
                          type="button" className="s5-act-btn" title="Download PDF"
                          onClick={() => void onDownloadPdf(docType, r.id, r.code)}
                          disabled={anyActing}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                        </button>
                        <button
                          type="button" className="s5-act-btn" title="Email to customer"
                          onClick={() => void onEmail(docType, r.id, r.code)}
                          disabled={anyActing}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                          </svg>
                        </button>
                        {/* G3: hide Convert on terminal states. A
                         *  `converted_to_pi` quote is already done; a
                         *  `cancelled` quote can't be revived. Either
                         *  click would trigger a server 409, so don't
                         *  bait the user. */}
                        {docType === 'quotation'
                          && (r.status ?? '').toLowerCase() !== 'converted_to_pi'
                          && (r.status ?? '').toLowerCase() !== 'cancelled' && (
                          <button
                            type="button" className="s5-act-btn s5-act-convert" title="Convert to PI"
                            onClick={() => void onConvertToPi(r as QuotationRow)}
                            disabled={anyActing}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                            <span>Convert</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="smd-stg-foot">
        <div className="smd-stg-foot-note">
          ⚠ <strong>Note :</strong> Share at least one quotation or PI before advancing to Stage 6.
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

      {/* ── Inline Create / Edit modals (lifted from SalesQPI) ── */}
      {createQtOpen && (
        <CreateQuotationModal
          editId={editQtId}
          initialOpp={editQtId == null ? initialOpp : undefined}
          onClose={() => { setCreateQtOpen(false); setEditQtId(null); }}
          onSubmit={() => {
            setCreateQtOpen(false);
            setEditQtId(null);
            void fetchAll(true);
          }}
        />
      )}
      {createPiOpen && (
        <CreatePIModal
          editId={editPiId}
          source={piSource}
          initialOpp={editPiId == null && !piSource ? initialOpp : undefined}
          onClose={() => { setCreatePiOpen(false); setEditPiId(null); setPiSource(null); }}
          onSubmit={() => {
            setCreatePiOpen(false);
            setEditPiId(null);
            setPiSource(null);
            void fetchAll(true);
            // Tell the parent the lead's PI set just changed so it
            // refetches /clm/leads/{id}/agreement-applicable — that's
            // what unlocks the Segment Details card on the left rail.
            // Fires for both create AND edit because edits can also
            // change the product list (and therefore which segments
            // / agreements apply).
            onPiChange?.();
          }}
        />
      )}
    </>
  );
}

const STAGE5_CSS = `
/* ─── Stage 5 head — teal/cyan gradient (matches the document/contract feel) ── */
.smd-s5-head {
  background: linear-gradient(110deg, #cffafe 0%, #a5f3fc 40%, #67e8f9 100%);
  border-bottom: 1px solid #67e8f9;
}
.smd-s5-head .smd-stg-head-icon { background: linear-gradient(135deg, #0e7490, #155e75); }
.smd-s5-head .smd-stg-head-title { color: #155e75; }
.smd-s5-head .smd-stg-head-sub   { color: #0e7490; }
.smd-s5-head .smd-stg-head-badge { background: linear-gradient(135deg, #0e7490, #155e75); }

/* ─── Tab row + create buttons ─── */
.s5-tab-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
}
.s5-tabs { display: flex; gap: 10px; flex-wrap: wrap; }
.s5-tab {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 9px 18px; border-radius: 999px;
  border: 1.5px solid; background: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.s5-tab-ico { display: inline-flex; }
.s5-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; font-weight: 800;
}
.s5-tab-q          { color: #0e7490; border-color: #a5f3fc; }
.s5-tab-q:hover    { background: #ecfeff; }
.s5-tab-q.active   { background: linear-gradient(135deg, #0e7490, #155e75); color: #fff; border-color: #155e75; box-shadow: 0 4px 12px rgba(14,116,144,.30); }
.s5-tab-q .s5-tab-count        { background: #cffafe; color: #155e75; }
.s5-tab-q.active .s5-tab-count { background: rgba(255,255,255,.22); color: #fff; }
.s5-tab-p          { color: #047857; border-color: #a7f3d0; }
.s5-tab-p:hover    { background: #ecfdf5; }
.s5-tab-p.active   { background: linear-gradient(135deg, #047857, #065f46); color: #fff; border-color: #065f46; box-shadow: 0 4px 12px rgba(4,120,87,.30); }
.s5-tab-p .s5-tab-count        { background: #d1fae5; color: #065f46; }
.s5-tab-p.active .s5-tab-count { background: rgba(255,255,255,.22); color: #fff; }

.s5-create-row { display: flex; gap: 8px; flex-wrap: wrap; }
.s5-create-btn {
  padding: 8px 16px; border-radius: 10px; border: 1.5px dashed;
  background: #fff;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.s5-create-q { color: #0e7490; border-color: #67e8f9; }
.s5-create-q:hover { background: #ecfeff; border-style: solid; border-color: #0e7490; }
.s5-create-p { color: #047857; border-color: #6ee7b7; }
.s5-create-p:hover { background: #ecfdf5; border-style: solid; border-color: #047857; }

/* ─── Summary band ─── */
.s5-summary {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0; margin-bottom: 14px;
  background: linear-gradient(180deg, #ecfeff, #cffafe);
  border: 1.5px solid #a5f3fc; border-radius: 12px; overflow: hidden;
}
.s5-summary-cell { padding: 12px 16px; border-right: 1px solid #a5f3fc; display: flex; flex-direction: column; gap: 4px; }
.s5-summary-cell:last-child { border-right: none; }
.s5-summary-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; color: #0e7490; text-transform: uppercase; }
.s5-summary-val { font-size: 16px; font-weight: 800; color: #155e75; min-height: 22px; display: inline-flex; align-items: center; }
/* G2: stacked per-currency totals when the rows mix INR/USD/etc. */
.s5-summary-mixed { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.s5-summary-mixed-row { font-size: 13px; font-weight: 800; color: #155e75; line-height: 1.2; }
/* G6: row whose action is in flight gets a subtle highlight */
.s5-row-acting { background: #f0fdfa; }

/* ─── Card / table ─── */
.s5-card {
  background: #fff;
  border: 1.5px solid #a5f3fc; border-radius: 14px; overflow: hidden;
}
.s5-card-head {
  display: flex; align-items: center; gap: 10px; padding: 13px 18px;
  background: linear-gradient(180deg, #ecfeff, #cffafe);
  border-bottom: 1.5px solid #a5f3fc;
}
.s5-card-head-icon {
  width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(135deg, #0e7490, #155e75);
  display: flex; align-items: center; justify-content: center;
}
.s5-card-title { font-size: 13.5px; font-weight: 800; color: #155e75; }
.s5-card-sub   { font-size: 11px; color: #0e7490; margin-top: 2px; }

.s5-table-wrap { overflow-x: auto; background: #fff; }
.s5-table { width: 100%; border-collapse: collapse; min-width: 920px; }
.s5-table thead th {
  padding: 11px 14px; text-align: left;
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: #155e75; white-space: nowrap;
}
.s5-table tbody td {
  padding: 12px 14px; font-size: 12px; color: #1e293b;
  border-bottom: 1px solid #f1f5f9; vertical-align: middle;
}
.s5-table tbody tr:hover { background: #ecfeff; }
.s5-empty { text-align: center; padding: 26px 14px; color: #94a3b8; font-style: italic; }

.s5-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 8px;
  background: #cffafe; color: #155e75;
  font-size: 11.5px; font-weight: 800;
}
.s5-code {
  font-family: 'Inter',monospace; font-size: 11.5px; font-weight: 800;
  background: #ecfeff; color: #0e7490; border: 1.5px solid #a5f3fc;
  padding: 4px 11px; border-radius: 7px;
}
.s5-code-link {
  cursor: pointer; transition: all .12s;
}
.s5-code-link:hover { background: #cffafe; border-color: #0e7490; color: #155e75; }
.s5-cust { display: flex; flex-direction: column; gap: 2px; }
.s5-cust-name { font-weight: 700; color: #1e293b; font-size: 12.5px; }
.s5-cust-code { font-size: 10.5px; color: #64748b; font-family: 'Inter',monospace; }
.s5-doctype {
  font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
  background: #ecfeff; color: #0e7490; border: 1.5px solid #a5f3fc;
}
.s5-ccy {
  font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 7px;
  background: #155e75; color: #fff;
}
.s5-value { font-weight: 800; color: #155e75; font-variant-numeric: tabular-nums; }
.s5-status {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; text-transform: capitalize;
}
.s5-status-draft     { background: #fef3c7; color: #b45309; }
.s5-status-sent      { background: #dbeafe; color: #1d4ed8; }
.s5-status-approved  { background: #d1fae5; color: #047857; }
.s5-status-cancelled { background: #fee2e2; color: #dc2626; }
.s5-status-converted { background: #ede9fe; color: #6d28d9; }
.s5-status-default   { background: #f1f5f9; color: #475569; }

.s5-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.s5-act-btn {
  width: 30px; height: 30px;
  background: #fff; border: 1.5px solid #a5f3fc; color: #0e7490;
  border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .12s;
}
.s5-act-btn:hover:not(:disabled) { background: #ecfeff; border-color: #0e7490; }
.s5-act-btn:disabled { opacity: .55; cursor: not-allowed; }
.s5-act-convert {
  width: auto; padding: 0 12px; gap: 5px;
  background: linear-gradient(135deg, #0e7490, #155e75); color: #fff;
  border-color: transparent; font-size: 11px; font-weight: 700;
}
.s5-act-convert span { display: inline; }
.s5-act-convert:hover:not(:disabled) {
  background: linear-gradient(135deg, #155e75, #164e63);
  transform: translateY(-1px);
}

/* Dark mode */
[data-bs-theme="dark"] .smd-s5-head {
  background: linear-gradient(110deg, #164e63 0%, #155e75 40%, #0e7490 100%);
  color: #ecfeff; border-bottom-color: rgba(103, 232, 249, .30);
}
[data-bs-theme="dark"] .smd-s5-head .smd-stg-head-title { color: #cffafe; }
[data-bs-theme="dark"] .smd-s5-head .smd-stg-head-sub   { color: #a5f3fc; }
[data-bs-theme="dark"] .s5-tab { background: #1a1538; }
[data-bs-theme="dark"] .s5-tab-q { color: #a5f3fc; border-color: rgba(165,243,252,.30); }
[data-bs-theme="dark"] .s5-tab-q:hover { background: rgba(165,243,252,.10); }
[data-bs-theme="dark"] .s5-tab-p { color: #6ee7b7; border-color: rgba(110,231,183,.30); }
[data-bs-theme="dark"] .s5-tab-p:hover { background: rgba(110,231,183,.10); }
[data-bs-theme="dark"] .s5-create-btn { background: #1f1845; }
[data-bs-theme="dark"] .s5-create-q { color: #a5f3fc; border-color: rgba(165,243,252,.45); }
[data-bs-theme="dark"] .s5-create-q:hover { background: rgba(165,243,252,.12); }
[data-bs-theme="dark"] .s5-create-p { color: #6ee7b7; border-color: rgba(110,231,183,.45); }
[data-bs-theme="dark"] .s5-create-p:hover { background: rgba(110,231,183,.12); }
[data-bs-theme="dark"] .s5-summary {
  background: rgba(14,116,144,.18); border-color: rgba(165,243,252,.30);
}
[data-bs-theme="dark"] .s5-summary-cell { border-right-color: rgba(165,243,252,.25); }
[data-bs-theme="dark"] .s5-summary-label { color: #a5f3fc; }
[data-bs-theme="dark"] .s5-summary-val   { color: #cffafe; }
[data-bs-theme="dark"] .s5-card { background: #14102a; border-color: rgba(165,243,252,.30); }
[data-bs-theme="dark"] .s5-card-head { background: rgba(14,116,144,.18); border-bottom-color: rgba(165,243,252,.30); }
[data-bs-theme="dark"] .s5-card-title { color: #cffafe; }
[data-bs-theme="dark"] .s5-card-sub   { color: #a5f3fc; }
[data-bs-theme="dark"] .s5-table-wrap { background: #14102a; }
[data-bs-theme="dark"] .s5-table thead th { background: #155e75; }
[data-bs-theme="dark"] .s5-table tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .s5-table tbody tr:hover { background: rgba(14,116,144,.20); }
[data-bs-theme="dark"] .s5-empty { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s5-sr { background: rgba(165,243,252,.18); color: #cffafe; }
[data-bs-theme="dark"] .s5-code { background: rgba(165,243,252,.14); color: #cffafe; border-color: rgba(165,243,252,.40); }
[data-bs-theme="dark"] .s5-cust-name { color: #ede9fe; }
[data-bs-theme="dark"] .s5-cust-code { color: rgba(196,181,253,.55); }
[data-bs-theme="dark"] .s5-doctype { background: rgba(165,243,252,.14); color: #cffafe; border-color: rgba(165,243,252,.40); }
[data-bs-theme="dark"] .s5-act-btn { background: #1f1845; border-color: rgba(165,243,252,.30); color: #cffafe; }
[data-bs-theme="dark"] .s5-act-btn:hover:not(:disabled) { background: #2a2150; border-color: #67e8f9; }

@media (max-width: 900px) {
  .s5-summary { grid-template-columns: 1fr; }
  .s5-summary-cell { border-right: none; border-bottom: 1px solid #a5f3fc; }
  .s5-summary-cell:last-child { border-bottom: none; }
}
`;
