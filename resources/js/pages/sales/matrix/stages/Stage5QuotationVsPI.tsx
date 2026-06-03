import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import SalesDocSendForSignatureModal from './SalesDocSendForSignatureModal';
import {
  CreateQuotationModal,
  CreatePIModal,
  prewarmQpiMasters,
  type QpiInitialOpp,
  type Quotation as QpiQuotation,
} from '../../SalesQPI';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 5: Quotation vs PI
 *
 *  Ported to the IDIMS reference design: teal/cyan header with a
 *  "View Latest Quoted Price Summary" button, a segmented Quotation /
 *  Proforma Invoice toggle, and a navy document table. Per-row actions:
 *  Convert to PI · Email · Edit · More (Download / View · With / Without
 *  Signature) · Delete.
 *
 *  The full 2-step Create Quotation / Create PI wizard from the SalesQPI
 *  workspace is lifted in via the exported modal components so the lead
 *  context is pre-fed. Save & Next persists lead_stage_id=6.
 * ───────────────────────────────────────────────────────────────────── */

type DocType = 'quotation' | 'pi';

type QuotationRow = {
  id:             number;
  code:           string | null;
  opp_id:         number | null;
  opp_code:       string | null;
  customer:       { id: number; customer_code: string | null; company_name: string | null } | null;
  consignee:      { id: number; consignee_code: string | null; company_name: string | null } | null;
  doc_type:       string | null;
  currency:       string | null;
  grand_total:    number | string | null;
  status:         string | null;
  created_at:     string;
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

const fmtNum = (v: number | string | null): string => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const titleCase = (s: string | null): string =>
  !s ? '—' : s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const isTerminalQuote = (s: string | null): boolean => {
  const lc = (s ?? '').toLowerCase();
  return lc === 'converted_to_pi' || lc === 'converted' || lc === 'cancelled';
};

/* Latest e-signature request per document row, surfaced in the action cell. */
type SigStatusRow = { id: number; status: string; docId: number };
const docTypeParam = (dt: DocType): 'quotation' | 'proforma_invoice' =>
  dt === 'pi' ? 'proforma_invoice' : 'quotation';

/* Currency may be stored as the full master label ("CAD – Canadian
 * Dollar") — the list column only wants the 3-letter code ("CAD"). */
const ccyCode = (c: string | null): string => {
  const code = (c ?? '').split(/[\s–-]/)[0]?.trim().toUpperCase();
  return code || '—';
};

export default function Stage5QuotationVsPI({ header, onPrev, onNext, reloadLead, onPiChange }: StageProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const leadId = header.leadId ?? null;

  const [docType, setDocType]   = useState<DocType>('quotation');
  const [loading, setLoading]   = useState(false);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [pis, setPis]           = useState<PIRow[]>([]);
  const [actingId, setActingId] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  /* The open More-Actions menu — tracks the row + a screen anchor rect so
   * the menu can be portalled to <body> (escaping the table's overflow). */
  const [moreMenu, setMoreMenu] = useState<{ kind: DocType; id: number; anchor: DOMRect } | null>(null);

  /* Send-for-Signature modal target + live signature status per row, keyed
   * by `${docType}:${docId}`. The status drives the action-cell control
   * (Send → Awaiting Sign + Remind → Signed + View). */
  const [sigSendFor, setSigSendFor] = useState<
    { kind: DocType; id: number; code: string | null; customerName: string | null } | null
  >(null);
  const [sigByRow, setSigByRow] = useState<Record<string, SigStatusRow>>({});

  const [createQtOpen, setCreateQtOpen]     = useState(false);
  const [createPiOpen, setCreatePiOpen]     = useState(false);
  const [editQtId, setEditQtId]             = useState<number | null>(null);
  const [editPiId, setEditPiId]             = useState<number | null>(null);
  const [piSource, setPiSource]             = useState<QpiQuotation | null>(null);

  /* Lead context handed to the Create modals so the lead's ALREADY-MAPPED
   * customer & consignee carry through as real selections (code + name +
   * FK id) — the user never re-picks them, and they can't drift to a
   * different customer/consignee than the lead was set up with. */
  const initialOpp: QpiInitialOpp | undefined = useMemo(() => {
    if (!leadId) return undefined;
    const custRow = (header.customerRow ?? null) as Record<string, unknown> | null;
    const consRow = (header.consigneeRow ?? null) as Record<string, unknown> | null;
    return {
      oppId:           leadId,
      oppCode:         header.oppId,
      oppDate:         header.oppDate,
      customerLabel:   (custRow?.company_name as string | undefined) ?? header.customer,
      customerCode:    (custRow?.customer_code as string | undefined) ?? header.customerCode,
      customerId:      header.customerId ?? null,
      consigneeLabel:  (consRow?.company_name as string | undefined) ?? undefined,
      consigneeCode:   (consRow?.consignee_code as string | undefined) ?? undefined,
      consigneeId:     header.consigneeId ?? null,
    };
  }, [leadId, header.oppId, header.oppDate, header.customer, header.customerCode, header.customerRow, header.customerId, header.consigneeRow, header.consigneeId]);

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
  useEffect(() => { prewarmQpiMasters(); }, []);

  /* ── E-signature status for the current doc-type tab. `sync` round-trips
   * Zoho server-side for any in-progress request so the chip flips to
   * Signed without a manual refresh. Keyed by `${docType}:${trade_doc_id}`. */
  const fetchSignatures = useCallback(async (sync = false) => {
    if (!leadId) return;
    try {
      const r = await api.get<{ status: boolean; data: any[] }>('/clm/signature-requests', {
        params: { lead_id: leadId, document_type: docTypeParam(docType), sync: sync ? 1 : 0 },
      });
      const rows = Array.isArray(r.data?.data) ? r.data.data : [];
      const map: Record<string, SigStatusRow> = {};
      rows.forEach((row: any) => {
        const did = row.trade_doc_id ?? (Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids[0] : null);
        if (did == null) return;
        const key = `${docType}:${did}`;
        if (!map[key] || row.id > map[key].id) {
          map[key] = { id: row.id, status: String(row.status ?? '').toLowerCase(), docId: Number(did) };
        }
      });
      setSigByRow(map);
    } catch { /* signature status is best-effort — never blocks the table */ }
  }, [leadId, docType]);

  useEffect(() => {
    if (!leadId) return;
    void fetchSignatures(true);
    const t = setInterval(() => void fetchSignatures(true), 20000);
    return () => clearInterval(t);
  }, [leadId, docType, fetchSignatures]);

  const onRemindSig = async (sigId: number) => {
    try {
      await api.post(`/clm/signature-requests/${sigId}/remind`);
      toast.success('Reminder sent', 'The signer has been reminded.');
    } catch (e: any) {
      toast.error('Reminder failed', e?.response?.data?.message ?? 'Could not send the reminder.');
    }
  };

  const onViewSignedSig = async (sigId: number) => {
    try {
      const r = await api.get(`/clm/signature-requests/${sigId}/view-file/0`, { responseType: 'blob' });
      window.open(URL.createObjectURL(r.data as Blob), '_blank');
    } catch (e: any) {
      toast.error('Open failed', e?.response?.data?.message ?? 'Could not open the signed document.');
    }
  };

  /* Auto-unlock the left CLM "Segment Details" card whenever this lead
   * ALREADY has at least one quotation or PI in the list — the user
   * shouldn't have to open (or submit) the Create/Edit form to trigger
   * it. Bumping the parent's /agreement-applicable refetch is idempotent.
   * onPiChange is intentionally left out of the deps (it's a fresh
   * closure each parent render) so this fires only when the row COUNT
   * changes (0 → 1), never on every re-render. */
  useEffect(() => {
    if (quotations.length > 0 || pis.length > 0) onPiChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotations.length, pis.length]);

  /* ── Per-row actions ─────────────────────────────────────────────── */
  const onViewPdf = async (kind: DocType, id: number, signature: boolean) => {
    setActingId(id);
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
      const res = await api.post(url, { signature }, { responseType: 'blob' });
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

  const onDownloadPdf = async (kind: DocType, id: number, code: string | null, signature: boolean) => {
    setActingId(id);
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
      const res = await api.post(url, { signature }, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const suffix = signature ? '_signed' : '';
      a.download = `${(code ?? `${kind}-${id}`).replace(/[^a-z0-9\-_.]/gi, '_')}${suffix}.pdf`;
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
      await fetchAll(true);
      setDocType('pi');
      toast.success('Converted to PI', `New proforma invoice ${code} created from ${q.code ?? 'this quotation'}.`);
      onPiChange?.();
    } catch (e: any) {
      toast.error('Conversion blocked', e?.response?.data?.message ?? 'Could not convert this quotation to a PI.');
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

  const onDelete = async (kind: DocType, id: number, code: string | null) => {
    const ok = await confirm({
      title: kind === 'quotation' ? 'Delete quotation?' : 'Delete proforma invoice?',
      message: `This permanently removes ${code ?? `#${id}`} from this opportunity. This can't be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    setActingId(id);
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}` : `/sales/proforma-invoices/${id}`;
      await api.delete(url);
      toast.success('Deleted', `${code ?? 'Document'} was removed from this opportunity.`);
      await fetchAll(true);
      if (kind === 'pi') onPiChange?.();
    } catch (e: any) {
      toast.error('Delete failed', e?.response?.data?.message ?? 'Could not delete this document.');
    } finally {
      setActingId(null);
    }
  };

  const onCreate = (kind: DocType) => {
    if (!leadId) {
      toast.warning('Open from worksheet', 'Re-enter this stage from the Lead Worksheet to attach a quotation.');
      return;
    }
    if (kind === 'quotation') { setEditQtId(null); setCreateQtOpen(true); }
    else                      { setPiSource(null); setEditPiId(null); setCreatePiOpen(true); }
  };

  const onEdit = (kind: DocType, id: number) => {
    // A signed document is locked — the signed copy must keep matching what
    // the customer e-signed. Block the edit and tell the user why.
    if (sigByRow[`${kind}:${id}`]?.status === 'completed') {
      toast.warning(
        kind === 'pi' ? 'PI already signed' : 'Quotation already signed',
        `This ${kind === 'pi' ? 'PI' : 'quotation'} has already been signed and can no longer be edited. Duplicate it to make changes.`,
      );
      return;
    }
    if (kind === 'quotation') { setEditQtId(id); setCreateQtOpen(true); }
    else                      { setEditPiId(id); setPiSource(null); setCreatePiOpen(true); }
  };

  const onSaveAndNext = async () => {
    if (!leadId) {
      toast.warning('Open from worksheet', 'Re-enter this stage from the Lead Worksheet to save your progress.');
      return;
    }
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
  const anyActing = actingId !== null;

  /* PI "Converted From" → resolve the source quotation's code from the
   * quotation list we already loaded. */
  const quotationCodeById = useMemo(() => {
    const m = new Map<number, string>();
    for (const q of quotations) if (q.code) m.set(q.id, q.code);
    return m;
  }, [quotations]);

  const liveQuotationsCount = useMemo(
    () => quotations.filter(q => (q.status ?? '').toLowerCase() !== 'cancelled').length,
    [quotations],
  );
  const livePisCount = useMemo(
    () => pis.filter(p => (p.status ?? '').toLowerCase() !== 'cancelled').length,
    [pis],
  );

  const colSpan = docType === 'quotation' ? 7 : 9;

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE5_CSS}</style>

      {/* ── Header (teal) with View-Summary button ── */}
      <div className="smd-stg-head">
        <div className="smd-stg-head-left">
          <div className="smd-stg-head-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <path d="M12 3v18M5 7l7-4 7 4M4 7l4 9a4 4 0 0 1-8 0zM16 7l4 9a4 4 0 0 1-8 0z"/>
            </svg>
          </div>
          <div>
            <div className="smd-stg-head-title">Stage 5: Quotation vs PI</div>
            <div className="smd-stg-head-sub">● Quotation / PI comparison underway</div>
          </div>
        </div>
        <div className="s5-head-right">
          <span className="smd-stg-head-badge">ACTIVE</span>
          <span className="s5-head-divider" />
          <button type="button" className="s5-summary-btn" onClick={() => setSummaryOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            View Latest Quoted Price Summary
          </button>
        </div>
      </div>

      <div className="smd-stg-body">
        {/* Segmented tab toggle + Create buttons (figma action row) */}
        <div className="s5-actionrow">
          <div className="s5-seg">
            <button
              type="button"
              className={`s5-seg-btn ${docType === 'quotation' ? 'active' : ''}`}
              onClick={() => setDocType('quotation')}
            >
              <span className="s5-seg-dot" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
              <span>Quotation</span>
            </button>
            <button
              type="button"
              className={`s5-seg-btn ${docType === 'pi' ? 'active' : ''}`}
              onClick={() => setDocType('pi')}
            >
              <span className="s5-seg-dot" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>
              </svg>
              <span>Proforma Invoice</span>
            </button>
          </div>
          <div className="s5-create-group">
            <button type="button" className="s5-create-btn s5-create-q" onClick={() => onCreate('quotation')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create Quotation
            </button>
            <span className="s5-create-div" />
            <button type="button" className="s5-create-btn s5-create-p" onClick={() => onCreate('pi')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Create PI
            </button>
          </div>
        </div>

        {/* Document table */}
        <div className="s5-tbl-card smd-fade-in" key={docType}>
          <div className="s5-tbl-wrap">
            <table className="s5-tbl">
              <thead>
                <tr>
                  <th className="ta-c" style={{ width: 52 }}>Sr No</th>
                  <th style={{ width: 150 }}>{docType === 'quotation' ? 'Quotation No' : 'PI No'}</th>
                  <th style={{ width: 120 }}>{docType === 'quotation' ? 'Quotation Date' : 'PI Date'}</th>
                  {docType === 'pi' && <th style={{ width: 140 }}>Converted From</th>}
                  <th style={{ width: 130 }}>Document Type</th>
                  <th style={{ width: 90 }}>Currency</th>
                  <th className="ta-r" style={{ width: 150 }}>{docType === 'quotation' ? 'Quotation Value' : 'PI Value'}</th>
                  {docType === 'pi' && <th className="ta-c" style={{ width: 100 }}>Status</th>}
                  <th className="ta-r">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="smd-fade-in">
                    {Array.from({ length: colSpan }).map((__, j) => (
                      <td key={j}><span className="smd-skel" style={{ maxWidth: j === colSpan - 1 ? 160 : 90 }} /></td>
                    ))}
                  </tr>
                ))}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="s5-empty">
                      {docType === 'quotation'
                        ? 'No quotations on this opportunity yet — click "+ Create Quotation" to start.'
                        : 'No proforma invoices yet. Convert a quotation to PI, or click "+ Create PI".'}
                    </td>
                  </tr>
                )}

                {!loading && rows.map((r, idx) => {
                  const terminal = docType === 'quotation' && isTerminalQuote(r.status);
                  return (
                    <tr key={r.id} className={anyActing && actingId === r.id ? 's5-row-acting' : undefined}>
                      <td className="ta-c"><span className="s5-sr2">{idx + 1}</span></td>
                      <td>
                        <button
                          type="button" className="s5-qno"
                          onClick={() => onEdit(docType, r.id)}
                          title={r.code ? 'Edit this document' : `Edit document #${r.id}`}
                          disabled={anyActing}
                        >
                          {r.code ?? `#${r.id}`}
                        </button>
                      </td>
                      <td className="s5-muted">{fmtDate(r.created_at)}</td>
                      {docType === 'pi' && (
                        <td>
                          {(() => {
                            const srcId = (r as PIRow).source_quotation_id;
                            const srcCode = srcId != null ? quotationCodeById.get(srcId) : undefined;
                            return srcId != null
                              ? <span className="s5-cf">{srcCode ?? `#${srcId}`}</span>
                              : <span className="s5-dash">—</span>;
                          })()}
                        </td>
                      )}
                      <td><span className="s5-dt2">{titleCase(r.doc_type)}</span></td>
                      <td><span className="s5-cur2">{ccyCode(r.currency)}</span></td>
                      <td className="ta-r"><span className="s5-val2">{fmtNum(r.grand_total)}</span></td>
                      {docType === 'pi' && (
                        <td className="ta-c">
                          {/* STATUS = e-signature lifecycle:
                              Not Sent (draft) → Sent (awaiting) → Signed. */}
                          {(() => {
                            const st = sigByRow[`${docType}:${r.id}`]?.status;
                            if (st === 'completed') {
                              return <span className="s5-st-live"><span className="s5-st-dot" />Signed</span>;
                            }
                            if (st === 'inprogress') {
                              return <span className="s5-st-live" style={{ background: '#fef9c3', color: '#854d0e', borderColor: '#fde68a' }}><span className="s5-st-dot" style={{ background: '#d97706' }} />Sent</span>;
                            }
                            return <span className="s5-st-live" style={{ background: '#f1f5f9', color: '#64748b', borderColor: '#e2e8f0' }}><span className="s5-st-dot" style={{ background: '#94a3b8' }} />Not Sent</span>;
                          })()}
                        </td>
                      )}
                      <td>
                        <div className="s5-acts">
                          {docType === 'quotation' && (
                            terminal ? (
                              <span className="s5-converted-chip">{titleCase(r.status)}</span>
                            ) : (
                              <button
                                type="button" className="s5-convert2" title="Convert to PI"
                                onClick={() => void onConvertToPi(r as QuotationRow)}
                                disabled={anyActing}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                                </svg>
                                Convert to PI
                              </button>
                            )
                          )}
                          {/* Send for Signature (Zoho Sign) — status-aware:
                              Send → Awaiting Sign (+Remind) → Signed (+View). */}
                          {(() => {
                            const sig = sigByRow[`${docType}:${r.id}`];
                            const st  = sig?.status;
                            if (st === 'inprogress') {
                              return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  {/* Sent → View the document that was sent + Remind the signer. */}
                                  <button type="button" className="s5-icn" title="View sent document" onClick={() => void onViewPdf(docType, r.id, true)} disabled={anyActing}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                  </button>
                                  <button type="button" className="s5-icn" title="Send signing reminder" onClick={() => void onRemindSig(sig!.id)} disabled={anyActing}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                                  </button>
                                </span>
                              );
                            }
                            if (st === 'completed') {
                              return (
                                <button type="button" className="s5-convert2" title="View the signed PDF" onClick={() => void onViewSignedSig(sig!.id)} disabled={anyActing} style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><polyline points="20 6 9 17 4 12"/></svg>
                                  Signed PDF
                                </button>
                              );
                            }
                            return (
                              <button
                                type="button" className="s5-convert2" title="Send for Signature"
                                onClick={() => setSigSendFor({ kind: docType, id: r.id, code: r.code, customerName: r.customer?.company_name ?? null })}
                                disabled={anyActing}
                                style={{ background: 'linear-gradient(135deg,#0ea5e9,#0284c7)' }}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
                                Send for Sign
                              </button>
                            );
                          })()}
                          <span className="s5-act-sep" />
                          <button type="button" className="s5-icn s5-icn-mail" title="Send via Email"
                            onClick={() => void onEmail(docType, r.id, r.code)} disabled={anyActing}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                          </button>
                          {(() => {
                            // A signed doc is locked — show the pencil greyed
                            // out; clicking still explains why (handled in onEdit).
                            const locked = sigByRow[`${docType}:${r.id}`]?.status === 'completed';
                            return (
                              <button
                                type="button" className="s5-icn s5-icn-edit"
                                title={locked ? `${docType === 'pi' ? 'PI' : 'Quotation'} signed — editing locked` : 'Edit'}
                                onClick={() => onEdit(docType, r.id)} disabled={anyActing}
                                style={locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            );
                          })()}
                          <button
                            type="button" className="s5-icn s5-icn-more" title="More Actions"
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                              setMoreMenu(prev => prev && prev.id === r.id && prev.kind === docType ? null : { kind: docType, id: r.id, anchor: rect });
                            }}
                            disabled={anyActing}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>
                          </button>
                          <button type="button" className="s5-icn s5-icn-del" title="Delete"
                            onClick={() => void onDelete(docType, r.id, r.code)} disabled={anyActing}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </div>
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
          ⚠ <strong>Note :</strong> Verify the quotation matches the proforma invoice before advancing to Stage 6.
        </div>
        <div className="smd-stg-btn-row">
          <button className="smd-stg-btn" onClick={onPrev} type="button">← Previous</button>
          <button className="smd-stg-btn smd-stg-btn-primary" onClick={() => void onSaveAndNext()} disabled={advancing} type="button">
            {advancing ? 'Advancing…' : 'Save & Next →'}
          </button>
        </div>
      </div>

      {/* ── More Actions menu (portalled) ── */}
      {moreMenu && (
        <MoreActionsMenu
          anchor={moreMenu.anchor}
          onClose={() => setMoreMenu(null)}
          onPick={(action, signature) => {
            const id = moreMenu.id, kind = moreMenu.kind;
            const code = (kind === 'quotation' ? quotations : pis).find(x => x.id === id)?.code ?? null;
            setMoreMenu(null);
            if (action === 'download') void onDownloadPdf(kind, id, code, signature);
            else                        void onViewPdf(kind, id, signature);
          }}
        />
      )}

      {/* ── View Latest Quoted Price Summary popup ── */}
      {summaryOpen && (
        <PriceSummaryModal leadId={leadId} onClose={() => setSummaryOpen(false)} />
      )}

      {/* ── Inline Create / Edit modals (lifted from SalesQPI) ── */}
      {createQtOpen && (
        <CreateQuotationModal
          editId={editQtId}
          initialOpp={editQtId == null ? initialOpp : undefined}
          onClose={() => { setCreateQtOpen(false); setEditQtId(null); }}
          onSubmit={() => {
            setCreateQtOpen(false); setEditQtId(null);
            void fetchAll(true);
            // A quotation also unlocks the Segment Details card (segments
            // derive from its mapped products), so refresh the parent's
            // agreement-applicable fetch.
            onPiChange?.();
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
            onPiChange?.();
          }}
        />
      )}

      {/* Send for Signature (Zoho Sign) — Quotation / PI */}
      {sigSendFor && leadId && (
        <SalesDocSendForSignatureModal
          open={!!sigSendFor}
          kind={sigSendFor.kind}
          docId={sigSendFor.id}
          docCode={sigSendFor.code}
          leadId={leadId}
          customerName={sigSendFor.customerName}
          onClose={() => setSigSendFor(null)}
          onSent={() => { void fetchSignatures(true); }}
        />
      )}
    </>
  );
}

/* ─── More Actions menu — fixed-position portal anchored to the 3-dot
 *      button. Download / View, each With / Without Signature. */
function MoreActionsMenu({ anchor, onClose, onPick }: {
  anchor: DOMRect;
  onClose: () => void;
  onPick: (action: 'download' | 'view', signature: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchor.bottom + 6, left: anchor.right - 210 });

  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 210;
    const h = ref.current?.offsetHeight ?? 230;
    let left = anchor.right - w;
    let top = anchor.bottom + 6;
    if (left < 8) left = 8;
    if (top + h > window.innerHeight - 8) top = anchor.top - h - 6;   // flip above
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const dl = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
  const eye = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;

  return createPortal(
    <div ref={ref} className="s5-menu" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
      <div className="s5-menu-head">
        <div className="s5-menu-head-left">
          <span className="s5-menu-head-ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="12" cy="5" r="1" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#fff"/><circle cx="12" cy="19" r="1" fill="#fff"/></svg></span>
          More Actions
        </div>
        <button type="button" className="s5-menu-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="s5-menu-body">
        <div className="s5-menu-sec s5-menu-sec-dl">⬇ Download</div>
        <button type="button" className="s5-menu-item s5-mi-dl" onClick={() => onPick('download', true)}><span className="s5-mi-ico">{dl}</span>With Signature</button>
        <button type="button" className="s5-menu-item s5-mi-dl" onClick={() => onPick('download', false)}><span className="s5-mi-ico">{dl}</span>Without Signature</button>
        <div className="s5-menu-div" />
        <div className="s5-menu-sec s5-menu-sec-vw">👁 View</div>
        <button type="button" className="s5-menu-item s5-mi-vw" onClick={() => onPick('view', true)}><span className="s5-mi-ico">{eye}</span>With Signature</button>
        <button type="button" className="s5-menu-item s5-mi-vw" onClick={() => onPick('view', false)}><span className="s5-mi-ico">{eye}</span>Without Signature</button>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Latest Quoted Price Summary popup ──────────────────────────────
 *  Shows the LATEST quoted price per product across all quotations on
 *  the lead — sourced from /sales/leads/{id}/shared-prices (the same
 *  append-only Price-Shared history Stage 4 writes). Rows are de-duped to
 *  the most recent entry per product; per-row View / Download open the
 *  shared-price PDF (/sales/shared-prices/{entryId}/pdf). */
type SharedRow = {
  id:            number;
  product_id:    number | null;
  product_code:  string | null;
  product_name:  string | null;
  currency:      string | null;
  quantity:      number | string | null;
  target_price:  number | string | null;
  quoted_price:  number | string | null;
  shared_at:     string;
};

const CCY_SYMBOL: Record<string, string> = { USD: '$', INR: '₹', EUR: '€', GBP: '£', AED: 'AED', AUD: 'A$', CAD: 'C$' };
const sym = (ccy: string | null): string => CCY_SYMBOL[(ccy ?? '').toUpperCase()] ?? ((ccy ?? '').toUpperCase() || '$');
const money = (n: number, ccy: string | null): string => `${sym(ccy)} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PriceSummaryModal({ leadId, onClose }: { leadId: number | null; onClose: () => void }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SharedRow[]>([]);
  const [actingId, setActingId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!leadId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.get<{ status: boolean; data: SharedRow[] }>(`/sales/leads/${leadId}/shared-prices`)
      .then(r => { if (!cancelled) setRows(r.data.data ?? []); })
      .catch(() => { if (!cancelled) toast.error('Load failed', 'Could not load the quoted price summary.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId, toast]);

  /* Latest entry per product. The list endpoint returns history newest-
   * first; keep the first occurrence of each product. */
  const latest = useMemo(() => {
    const seen = new Set<number | string>();
    const out: SharedRow[] = [];
    const sorted = [...rows].sort((a, b) => new Date(b.shared_at).getTime() - new Date(a.shared_at).getTime());
    for (const r of sorted) {
      const key = r.product_id ?? r.product_code ?? r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [rows]);

  const ccy = latest[0]?.currency ?? 'USD';
  const totalQty    = latest.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
  const totalTarget = latest.reduce((s, r) => s + (Number(r.target_price) || 0), 0);
  const totalQuoted = latest.reduce((s, r) => s + (Number(r.quoted_price) || 0), 0);
  const variance    = totalQuoted - totalTarget;
  const variancePct = totalTarget > 0 ? ((variance / totalTarget) * 100).toFixed(1) : '0.0';
  const over        = variance > 0;

  const today = new Date();
  const asOf = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  const pdf = async (entryId: number, download: boolean) => {
    setActingId(entryId);
    try {
      const res = await api.get(`/sales/shared-prices/${entryId}/pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      if (download) {
        const a = document.createElement('a');
        a.href = url; a.download = `quoted_price_${String(entryId).padStart(5, '0')}.pdf`; a.click();
        URL.revokeObjectURL(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch {
      toast.error(download ? 'Download failed' : 'Open failed', 'Could not open the quoted price PDF.');
    } finally {
      setActingId(null);
    }
  };

  const fmtRowDate = (s: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
    return {
      date: d.toLocaleDateString('en-GB'),
      time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase(),
    };
  };

  /* Export Report → an Excel workbook of the latest-per-product summary
   * (one row per product + a Totals row). Uses the same `xlsx` lib the
   * rest of the app exports with. */
  const onExportReport = () => {
    if (!latest.length) { toast.warning('Nothing to export', 'No quoted prices to include in the report.'); return; }
    try {
      const body = latest.map((r, i) => {
        const tp = Number(r.target_price) || 0;
        const qp = Number(r.quoted_price) || 0;
        const { date, time } = fmtRowDate(r.shared_at);
        return {
          'Sr No': i + 1,
          'Product Code': r.product_code ?? `P-${String(r.product_id ?? 0).padStart(3, '0')}`,
          'Product Name': r.product_name ?? '',
          'Date': date,
          'Time': time,
          'Quantity': Number(r.quantity) || 0,
          'Currency': (r.currency ?? ccy).toUpperCase(),
          'Target Price': tp,
          'Quoted Price': qp,
          'Variance': qp - tp,
        };
      });
      body.push({
        'Sr No': '' as never, 'Product Code': '' as never, 'Product Name': 'TOTAL' as never,
        'Date': '' as never, 'Time': '' as never,
        'Quantity': totalQty, 'Currency': ccy.toUpperCase() as never,
        'Target Price': totalTarget, 'Quoted Price': totalQuoted, 'Variance': variance,
      });
      const ws = XLSX.utils.json_to_sheet(body);
      ws['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Quoted Price Summary');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const stamp = new Date().toISOString().slice(0, 10);
      saveAs(
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `QuotedPriceSummary_${stamp}.xlsx`,
      );
      toast.success('Report exported', `${latest.length} product${latest.length === 1 ? '' : 's'} saved to an Excel workbook.`);
    } catch (err: any) {
      toast.error('Export failed', err?.message || 'Could not generate the report.');
    }
  };

  return createPortal(
    <div className="s5-ps-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="s5-ps-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="s5-ps-head">
          <div className="s5-ps-head-left">
            <span className="s5-ps-head-ico">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#7dd3fc" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </span>
            <div>
              <div className="s5-ps-title">Latest Quoted Price Summary</div>
              <div className="s5-ps-sub">Most recent quoted price for each product across all quotations</div>
            </div>
          </div>
          <div className="s5-ps-head-right">
            <span className="s5-ps-pill"><span className="s5-ps-pill-dot" />{latest.length} Products</span>
            <span className="s5-ps-asof"><span className="s5-ps-asof-lbl">As of Date</span><span className="s5-ps-asof-val">{asOf}</span></span>
            <button type="button" className="s5-ps-x" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="s5-ps-stats">
          <div className="s5-ps-stat s5-ps-stat-tint"><div className="s5-ps-stat-lbl">Total Products</div><div className="s5-ps-stat-val c-cyan">{latest.length} items</div></div>
          <div className="s5-ps-stat"><div className="s5-ps-stat-lbl">Total Quantity</div><div className="s5-ps-stat-val c-cyan">{totalQty.toLocaleString()} units</div></div>
          <div className="s5-ps-stat s5-ps-stat-tint"><div className="s5-ps-stat-lbl">Total Target</div><div className="s5-ps-stat-val c-blue">{money(totalTarget, ccy)}</div></div>
          <div className="s5-ps-stat"><div className="s5-ps-stat-lbl">Total Quoted</div><div className="s5-ps-stat-val c-green">{money(totalQuoted, ccy)}</div></div>
          <div className={`s5-ps-stat ${over ? 's5-ps-stat-red' : 's5-ps-stat-grn'}`}>
            <div className="s5-ps-stat-lbl">Variance</div>
            <div className={`s5-ps-stat-val ${over ? 'c-red' : 'c-green'}`}>{over ? '+' : ''}{variance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({variancePct}%)</div>
          </div>
        </div>

        {/* Table */}
        <div className="s5-ps-tablewrap">
          <table className="s5-ps-table">
            <thead>
              <tr>
                <th className="ta-c" style={{ width: 52 }}>Sr No</th>
                <th style={{ width: 110 }}>Product Code</th>
                <th>Product Name</th>
                <th style={{ width: 120 }}>Date</th>
                <th className="ta-r" style={{ width: 90 }}>Quantity</th>
                <th className="ta-r" style={{ width: 120 }}>Target Price</th>
                <th className="ta-r" style={{ width: 120 }}>Quoted Price</th>
                <th className="ta-c" style={{ width: 90 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="s5-ps-empty">Loading latest quoted prices…</td></tr>
              )}
              {!loading && latest.length === 0 && (
                <tr><td colSpan={8} className="s5-ps-empty">No quoted prices shared yet — add them in Stage 4 (Price Shared).</td></tr>
              )}
              {!loading && latest.map((r, i) => {
                const { date, time } = fmtRowDate(r.shared_at);
                const tp = Number(r.target_price) || 0;
                const qp = Number(r.quoted_price) || 0;
                const diff = qp - tp;
                const rOver = diff > 0;
                return (
                  <tr key={r.id}>
                    <td className="ta-c"><span className="s5-ps-sr">{i + 1}</span></td>
                    <td><code className="s5-ps-code">{r.product_code ?? `P-${String(r.product_id ?? 0).padStart(3, '0')}`}</code></td>
                    <td><div className="s5-ps-name" title={r.product_name ?? ''}>{r.product_name ?? '—'}</div></td>
                    <td><div className="s5-ps-date">{date}</div>{time && <div className="s5-ps-time">{time}</div>}</td>
                    <td className="ta-r s5-ps-qty">{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                    <td className="ta-r"><div className="s5-ps-target">{money(tp, r.currency)}</div></td>
                    <td className="ta-r">
                      <div className={`s5-ps-quoted ${rOver ? 'c-red' : 'c-green'}`}>{money(qp, r.currency)}</div>
                      {diff !== 0 && (
                        <span className={`s5-ps-diff ${rOver ? 'over' : 'under'}`}>{rOver ? '▲' : '▼'} {sym(r.currency)}{Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      )}
                    </td>
                    <td className="ta-c">
                      <div className="s5-ps-acts">
                        <button type="button" className="s5-ps-act" title="View" disabled={actingId !== null} onClick={() => void pdf(r.id, false)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button type="button" className="s5-ps-act s5-ps-act-dl" title="Download" disabled={actingId !== null} onClick={() => void pdf(r.id, true)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="s5-ps-foot">
          <div className="s5-ps-foot-note"><span className="s5-ps-foot-dot" />Showing latest price per product · Updated today</div>
          <div className="s5-ps-foot-btns">
            <button type="button" className="s5-ps-export" disabled={loading || latest.length === 0} onClick={onExportReport}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Report
            </button>
            <button type="button" className="s5-ps-close-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const STAGE5_CSS = `
/* ─── Stage 5 head uses the default purple .smd-stg-head (matches Stage 4). ── */
.s5-head-right { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.s5-head-divider { width: 1px; height: 22px; background: rgba(124,58,237,.25); }
.s5-summary-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 13px; border-radius: 9px; cursor: pointer;
  font-family: inherit; font-size: 10.5px; font-weight: 700; white-space: nowrap;
  background: linear-gradient(135deg, #4c1d95, #6d28d9); color: #fff; border: none;
  box-shadow: 0 3px 10px rgba(124,58,237,.40), inset 0 1px 0 rgba(255,255,255,.16);
  transition: all .18s;
}
.s5-summary-btn:hover { background: linear-gradient(135deg, #3b0764, #7c3aed); box-shadow: 0 5px 15px rgba(124,58,237,.55); transform: translateY(-1px); }

/* ─── Action row — figma segmented tabs + create buttons ─── */
.s5-actionrow {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 35%, #f3f0ff 65%, #faf5ff 100%);
  border: 1.5px solid rgba(167,139,250,.55); border-radius: 14px;
  padding: 8px 10px 8px 8px; margin-bottom: 12px;
  box-shadow: 0 2px 16px rgba(124,58,237,.10), inset 0 1px 0 rgba(255,255,255,.8);
}
.s5-actionrow::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%; background: linear-gradient(180deg, rgba(255,255,255,.55), transparent); pointer-events: none; border-radius: 14px 14px 0 0; }
.s5-seg {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 4px 5px; border-radius: 12px;
  background: rgba(255,255,255,.6); border: 1.5px solid rgba(167,139,250,.4);
  box-shadow: 0 1px 6px rgba(124,58,237,.08), inset 0 1px 0 rgba(255,255,255,.9);
}
.s5-seg-btn {
  position: relative; display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 18px; border-radius: 9px; cursor: pointer; white-space: nowrap;
  font-family: inherit; font-size: 11px; font-weight: 600; letter-spacing: .01em;
  background: rgba(255,255,255,.75); color: #6d28d9;
  border: 1.5px solid rgba(124,58,237,.2);
  box-shadow: 0 1px 4px rgba(124,58,237,.08);
  transition: all .22s cubic-bezier(.4,0,.2,1);
}
.s5-seg-btn:hover:not(.active) { background: #fff; border-color: rgba(124,58,237,.32); }
.s5-seg-btn.active {
  font-weight: 700; color: #fff; border: none;
  background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%);
  box-shadow: 0 4px 14px rgba(124,58,237,.45), inset 0 1px 0 rgba(255,255,255,.2);
  text-shadow: 0 1px 2px rgba(0,0,0,.2);
}
.s5-seg-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background: #a78bfa; box-shadow: 0 0 4px rgba(167,139,250,.5); }
.s5-seg-btn.active .s5-seg-dot { background: rgba(255,255,255,.85); box-shadow: 0 0 6px rgba(255,255,255,.6); }
.s5-seg-btn svg { flex-shrink: 0; }

.s5-create-group { position: relative; z-index: 1; display: flex; align-items: center; gap: 7px; }
.s5-create-div { width: 1px; height: 26px; flex-shrink: 0; background: linear-gradient(180deg, transparent, rgba(124,58,237,.25), transparent); }
.s5-create-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; border-radius: 9px; cursor: pointer; white-space: nowrap;
  font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .02em;
  transition: all .22s cubic-bezier(.4,0,.2,1);
}
.s5-create-q { color: #5b21b6; border: 1.5px solid rgba(124,58,237,.3); background: linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%); box-shadow: 0 2px 8px rgba(124,58,237,.15), inset 0 1px 0 rgba(255,255,255,.9); }
.s5-create-q:hover { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; border-color: transparent; box-shadow: 0 6px 18px rgba(124,58,237,.45); transform: translateY(-2px); }
.s5-create-p { color: #fff; border: none; background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); box-shadow: 0 4px 14px rgba(124,58,237,.4), inset 0 1px 0 rgba(255,255,255,.2); }
.s5-create-p:hover { background: linear-gradient(135deg, #6d28d9, #4c1d95); box-shadow: 0 6px 18px rgba(124,58,237,.55); transform: translateY(-2px); }

/* ─── Table card ─── */
.s5-tbl-card { border: 1.5px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.06); background: #fff; }
.s5-tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.s5-tbl { width: 100%; min-width: 880px; border-collapse: collapse; }
.s5-tbl thead tr { background: linear-gradient(90deg, #5b21b6 0%, #7c3aed 55%, #5b21b6 100%); box-shadow: 0 2px 8px rgba(124,58,237,.28); }
.s5-tbl thead th {
  padding: 11px 14px; text-align: left; white-space: nowrap;
  font-size: 9px; font-weight: 800; color: rgba(255,255,255,.93);
  text-transform: uppercase; letter-spacing: .1em;
}
.s5-tbl thead th.ta-c { text-align: center; }
.s5-tbl thead th.ta-r { text-align: right; }
.s5-tbl tbody td { padding: 10px 13px; font-size: 11.5px; vertical-align: middle; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
.s5-tbl tbody td.ta-c { text-align: center; }
.s5-tbl tbody td.ta-r { text-align: right; }
.s5-tbl tbody tr:nth-child(even) { background: #f8fafc; }
.s5-tbl tbody tr:hover { background: #f5f3ff; }
.s5-row-acting { background: #ede9fe !important; }
.s5-empty { text-align: center; padding: 30px 14px; color: #94a3b8; font-style: italic; }
.s5-muted { color: #64748b; }
.s5-dash { color: #cbd5e1; font-weight: 700; }

.s5-sr2 {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe); color: #6d28d9;
  font-size: 10px; font-weight: 800; border: 1.5px solid #c4b5fd;
}
.s5-qno {
  background: none; border: none; cursor: pointer; padding: 0;
  color: #7c3aed; font-weight: 800; font-family: ui-monospace, monospace; font-size: 11.5px; letter-spacing: .02em;
}
.s5-qno:hover:not(:disabled) { text-decoration: underline; }
.s5-qno:disabled { cursor: default; opacity: .8; }
.s5-cf { background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 1px solid #c4b5fd; border-radius: 6px; padding: 2px 9px; font-size: 10.5px; font-weight: 800; color: #6d28d9; font-family: ui-monospace, monospace; }
.s5-dt2 { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: #dbeafe; color: #1d4ed8; border: 1px solid #bfdbfe; }
.s5-cur2 { display: inline-flex; padding: 3px 10px; border-radius: 6px; font-size: 10.5px; font-weight: 800; background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
.s5-val2 { font-weight: 800; color: #059669; font-size: 12px; font-family: ui-monospace, monospace; }
.s5-st-live { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.s5-st-dot { width: 5px; height: 5px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 4px rgba(34,197,94,.8); }

/* ─── Action cell ─── */
.s5-acts { display: flex; align-items: center; justify-content: flex-end; gap: 5px; flex-wrap: nowrap; }
.s5-act-sep { width: 1px; height: 20px; background: #e2e8f0; flex-shrink: 0; }
.s5-convert2 {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 8px; cursor: pointer; flex-shrink: 0; white-space: nowrap;
  font-family: inherit; font-size: 10px; font-weight: 700;
  background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; border: none;
  box-shadow: 0 2px 8px rgba(124,58,237,.3); transition: all .15s;
}
.s5-convert2:hover:not(:disabled) { background: linear-gradient(135deg, #6d28d9, #4c1d95); box-shadow: 0 4px 12px rgba(124,58,237,.45); transform: translateY(-1px); }
.s5-convert2:disabled { opacity: .55; cursor: not-allowed; }
.s5-converted-chip { display: inline-flex; align-items: center; padding: 4px 11px; border-radius: 20px; font-size: 9.5px; font-weight: 800; background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; white-space: nowrap; }
.s5-icn {
  width: 28px; height: 28px; border-radius: 7px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid; transition: all .15s;
}
.s5-icn:disabled { opacity: .5; cursor: not-allowed; }
.s5-icn-mail { background: #eff6ff; border-color: #bfdbfe; color: #3b82f6; }
.s5-icn-mail:hover:not(:disabled) { background: #3b82f6; color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-icn-edit { background: #f0fdf4; border-color: #bbf7d0; color: #16a34a; }
.s5-icn-edit:hover:not(:disabled) { background: #16a34a; color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-icn-more { background: #f8fafc; border-color: #e2e8f0; color: #64748b; }
.s5-icn-more:hover:not(:disabled) { background: #475569; color: #fff; border-color: transparent; }
.s5-icn-del { background: #fff1f2; border-color: #fecaca; color: #ef4444; }
.s5-icn-del:hover:not(:disabled) { background: #ef4444; color: #fff; border-color: transparent; transform: translateY(-1px); }

/* ─── More Actions menu (portal) ─── */
.s5-menu {
  position: fixed; z-index: 3000; min-width: 210px;
  background: #fff; border: 1.5px solid rgba(124,58,237,.2); border-radius: 13px; overflow: hidden;
  box-shadow: 0 12px 32px rgba(124,58,237,.18), 0 4px 12px rgba(0,0,0,.08);
  animation: smd-fade-in .14s ease-out both;
}
.s5-menu-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 13px 7px; border-bottom: 1px solid #f1f5f9; }
.s5-menu-head-left { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; color: #4c1d95; letter-spacing: .04em; }
.s5-menu-head-ico { width: 20px; height: 20px; border-radius: 6px; background: linear-gradient(135deg, #7c3aed, #5b21b6); display: inline-flex; align-items: center; justify-content: center; }
.s5-menu-x { width: 18px; height: 18px; border: none; background: #f1f5f9; border-radius: 4px; cursor: pointer; color: #94a3b8; font-size: 11px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.s5-menu-x:hover { background: #e2e8f0; }
.s5-menu-body { padding: 5px 0; }
.s5-menu-sec { padding: 5px 13px 3px; font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .14em; }
.s5-menu-sec-dl { color: #6d28d9; }
.s5-menu-sec-vw { color: #7c3aed; }
.s5-menu-item {
  display: flex; align-items: center; gap: 9px; width: calc(100% - 10px); margin: 1px 5px;
  padding: 7px 13px; border: none; background: none; cursor: pointer; border-radius: 7px;
  font-family: inherit; font-size: 10.5px; font-weight: 600; color: #0f172a; text-align: left; transition: all .13s;
}
.s5-mi-ico { width: 24px; height: 24px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.s5-mi-dl .s5-mi-ico { background: rgba(109,40,217,.1); color: #6d28d9; }
.s5-mi-vw .s5-mi-ico { background: rgba(124,58,237,.1); color: #7c3aed; }
.s5-mi-dl:hover { background: rgba(109,40,217,.1); color: #6d28d9; padding-left: 16px; }
.s5-mi-vw:hover { background: rgba(124,58,237,.1); color: #7c3aed; padding-left: 16px; }
.s5-menu-div { height: 1px; background: linear-gradient(90deg, rgba(124,58,237,.15), rgba(124,58,237,.05), transparent); margin: 5px 8px; }

/* ─── Latest Quoted Price Summary popup (figma) ─── */
.s5-ps-backdrop { position: fixed; inset: 0; z-index: 2900; background: rgba(8,30,60,.58); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 14px; }
.s5-ps-modal { width: min(1000px, 100%); max-height: 86vh; background: #fff; border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 28px 70px rgba(8,30,60,.38), 0 6px 20px rgba(0,0,0,.1); animation: smd-fade-in .2s ease-out both; }

/* Header */
.s5-ps-head { position: relative; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 22px; background: linear-gradient(115deg, #0f172a 0%, #0c4a6e 50%, #0e7490 100%); }
.s5-ps-head::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%; background: linear-gradient(180deg, rgba(255,255,255,.07), transparent); pointer-events: none; }
.s5-ps-head-left { position: relative; display: flex; align-items: center; gap: 12px; }
.s5-ps-head-ico { width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0; background: rgba(255,255,255,.1); border: 1.5px solid rgba(125,211,252,.35); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 12px rgba(0,0,0,.2); }
.s5-ps-title { font-size: 15px; font-weight: 900; color: #fff; letter-spacing: -.4px; line-height: 1.1; }
.s5-ps-sub { font-size: 9px; color: rgba(125,211,252,.85); font-weight: 600; margin-top: 2px; letter-spacing: .04em; }
.s5-ps-head-right { position: relative; display: flex; align-items: center; gap: 10px; }
.s5-ps-pill { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.1); border: 1px solid rgba(125,211,252,.25); border-radius: 20px; padding: 5px 13px; font-size: 10px; font-weight: 700; color: #fff; white-space: nowrap; }
.s5-ps-pill-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 6px rgba(74,222,128,.8); }
.s5-ps-asof { display: inline-flex; flex-direction: column; background: rgba(255,255,255,.08); border: 1px solid rgba(125,211,252,.22); border-radius: 9px; padding: 6px 12px; }
.s5-ps-asof-lbl { font-size: 7.5px; font-weight: 700; color: rgba(255,255,255,.5); text-transform: uppercase; letter-spacing: .12em; margin-bottom: 1px; }
.s5-ps-asof-val { font-size: 11px; font-weight: 800; color: #fff; }
.s5-ps-x { width: 32px; height: 32px; border-radius: 9px; border: 1.5px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: rgba(255,255,255,.7); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; transition: all .15s; }
.s5-ps-x:hover { background: rgba(239,68,68,.35); border-color: rgba(239,68,68,.5); color: #fff; }

/* Stats bar */
.s5-ps-stats { display: flex; align-items: stretch; flex-shrink: 0; background: linear-gradient(90deg, #f0f9ff, #ecfeff, #f0f9ff); border-bottom: 1.5px solid #bae6fd; }
.s5-ps-stat { flex: 1; padding: 10px 14px; border-right: 1px solid #bae6fd; }
.s5-ps-stat:last-child { border-right: none; }
.s5-ps-stat-tint { background: rgba(8,145,178,.07); }
.s5-ps-stat-red { background: rgba(239,68,68,.06); }
.s5-ps-stat-grn { background: rgba(5,150,105,.06); }
.s5-ps-stat-lbl { font-size: 7.5px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 3px; }
.s5-ps-stat-val { font-size: 12px; font-weight: 900; font-family: ui-monospace, monospace; letter-spacing: .01em; }
.s5-ps-stat-val.c-cyan { color: #0891b2; }
.s5-ps-stat-val.c-blue { color: #0369a1; }
.s5-ps-stat-val.c-green { color: #059669; }
.s5-ps-stat-val.c-red { color: #dc2626; }

/* Table */
.s5-ps-tablewrap { flex: 1; overflow-y: auto; }
.s5-ps-table { width: 100%; border-collapse: collapse; }
.s5-ps-table thead tr { background: linear-gradient(90deg, #0f172a 0%, #1e3a5f 55%, #0f172a 100%); box-shadow: 0 2px 8px rgba(0,0,0,.22); }
.s5-ps-table thead th { padding: 11px 13px; text-align: left; white-space: nowrap; font-size: 8.5px; font-weight: 800; color: rgba(255,255,255,.93); text-transform: uppercase; letter-spacing: .1em; position: sticky; top: 0; }
.s5-ps-table thead th.ta-c { text-align: center; }
.s5-ps-table thead th.ta-r { text-align: right; }
.s5-ps-table tbody td { padding: 11px 13px; font-size: 11.5px; vertical-align: middle; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
.s5-ps-table tbody td.ta-c { text-align: center; }
.s5-ps-table tbody td.ta-r { text-align: right; }
.s5-ps-table tbody tr:nth-child(even) { background: #f8fafc; }
.s5-ps-table tbody tr:hover { background: #f0f9ff; }
.s5-ps-empty { text-align: center; padding: 34px 14px; color: #94a3b8; font-style: italic; }
.s5-ps-sr { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg, #e0f2fe, #bae6fd); color: #0369a1; font-size: 10px; font-weight: 800; border: 1.5px solid #7dd3fc; }
.s5-ps-code { background: linear-gradient(135deg, #f0f9ff, #e0f2fe); border: 1px solid #bae6fd; border-radius: 6px; padding: 3px 9px; font-size: 10.5px; font-weight: 800; color: #0369a1; font-family: ui-monospace, monospace; letter-spacing: .04em; }
.s5-ps-name { font-weight: 700; color: #0f172a; font-size: 11.5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s5-ps-date { font-size: 11px; font-weight: 700; color: #334155; }
.s5-ps-time { font-size: 9.5px; font-weight: 600; color: #0891b2; margin-top: 1px; }
.s5-ps-qty { font-weight: 800; color: #0f172a; font-family: ui-monospace, monospace; }
.s5-ps-target { font-weight: 800; color: #0369a1; font-family: ui-monospace, monospace; font-size: 12px; }
.s5-ps-quoted { font-weight: 900; font-family: ui-monospace, monospace; font-size: 12px; }
.s5-ps-quoted.c-green { color: #059669; }
.s5-ps-quoted.c-red { color: #dc2626; }
.s5-ps-diff { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; border-radius: 4px; font-size: 8.5px; font-weight: 800; margin-top: 2px; }
.s5-ps-diff.over { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
.s5-ps-diff.under { background: #dcfce7; color: #16a34a; border: 1px solid #86efac; }
.s5-ps-acts { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.s5-ps-act { width: 30px; height: 30px; border-radius: 8px; border: 1.5px solid #bae6fd; background: #f0f9ff; color: #0891b2; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all .15s; }
.s5-ps-act:hover:not(:disabled) { background: #0891b2; color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-ps-act-dl:hover:not(:disabled) { background: #0c4a6e; }
.s5-ps-act:disabled { opacity: .5; cursor: not-allowed; }

/* Footer */
.s5-ps-foot { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 22px; border-top: 1.5px solid #e2e8f0; background: linear-gradient(90deg, #f8fafc, #f0f9ff); }
.s5-ps-foot-note { display: inline-flex; align-items: center; gap: 8px; font-size: 10px; font-weight: 700; color: #64748b; }
.s5-ps-foot-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,.7); }
.s5-ps-foot-btns { display: flex; align-items: center; gap: 8px; }
.s5-ps-export { display: inline-flex; align-items: center; gap: 6px; padding: 7px 16px; border-radius: 9px; border: 1.5px solid rgba(8,145,178,.3); background: linear-gradient(135deg, #fff, #f0f9ff); font-family: inherit; font-size: 10.5px; font-weight: 700; color: #0369a1; cursor: pointer; box-shadow: 0 1px 4px rgba(8,145,178,.1); transition: all .15s; }
.s5-ps-export:hover:not(:disabled) { background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-ps-export:disabled { opacity: .5; cursor: not-allowed; }
.s5-ps-close-btn { padding: 7px 18px; border-radius: 9px; border: none; cursor: pointer; font-family: inherit; font-size: 10.5px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 3px 10px rgba(8,145,178,.32); transition: all .15s; }
.s5-ps-close-btn:hover { background: linear-gradient(135deg, #0369a1, #0c4a6e); transform: translateY(-1px); }

/* ─── Dark mode ─── */
[data-bs-theme="dark"] .smd-s5-head { background: linear-gradient(110deg, #164e63 0%, #155e75 40%, #0e7490 100%); color: #ecfeff; border-bottom-color: rgba(103,232,249,.30); }
[data-bs-theme="dark"] .smd-s5-head .smd-stg-head-title { color: #cffafe; }
[data-bs-theme="dark"] .smd-s5-head .smd-stg-head-sub { color: #a5f3fc; }
[data-bs-theme="dark"] .s5-head-divider { background: rgba(165,243,252,.25); }
/* Action row (tabs + create buttons) — dark surface instead of the light
   cyan gradient so it reads as part of the dark panel. */
[data-bs-theme="dark"] .s5-actionrow {
  background: linear-gradient(110deg, #14102a 0%, #1a1538 45%, #14102a 100%);
  border-color: rgba(124,58,237,.30);
  box-shadow: 0 2px 16px rgba(0,0,0,.30);
}
[data-bs-theme="dark"] .s5-actionrow::before { display: none; }
[data-bs-theme="dark"] .s5-seg { background: rgba(124,58,237,.16); border-color: rgba(167,139,250,.25); box-shadow: none; }
[data-bs-theme="dark"] .s5-seg-btn { color: #c4b5fd; background: rgba(167,139,250,.08); border-color: rgba(167,139,250,.20); box-shadow: none; }
[data-bs-theme="dark"] .s5-seg-btn:hover:not(.active) { background: rgba(167,139,250,.16); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .s5-seg-btn.active { color: #fff; background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); border: none; }
[data-bs-theme="dark"] .s5-create-div { background: linear-gradient(180deg, transparent, rgba(167,139,250,.30), transparent); }
[data-bs-theme="dark"] .s5-create-q { background: #1f1845; color: #c4b5fd; border-color: rgba(167,139,250,.40); box-shadow: none; }
[data-bs-theme="dark"] .s5-tbl-card { background: #14102a; border-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .s5-tbl tbody td { color: #ede9fe; border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .s5-tbl tbody tr:nth-child(even) { background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .s5-tbl tbody tr:hover { background: rgba(124,58,237,.20); }
[data-bs-theme="dark"] .s5-muted { color: #94a3b8; }
[data-bs-theme="dark"] .s5-cur2 { background: rgba(148,163,184,.18); color: #cbd5e1; border-color: rgba(148,163,184,.30); }
[data-bs-theme="dark"] .s5-dt2 { background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.35); }
[data-bs-theme="dark"] .s5-cf { background: rgba(56,189,248,.15); color: #7dd3fc; border-color: rgba(56,189,248,.35); }
[data-bs-theme="dark"] .s5-st-live { background: rgba(34,197,94,.18); color: #86efac; border-color: rgba(34,197,94,.35); }
[data-bs-theme="dark"] .s5-converted-chip { background: rgba(139,92,246,.20); color: #c4b5fd; border-color: rgba(139,92,246,.35); }
[data-bs-theme="dark"] .s5-menu { background: #14102a; border-color: rgba(124,58,237,.35); }
[data-bs-theme="dark"] .s5-menu-head { border-bottom-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .s5-menu-head-left { color: #a5f3fc; }
[data-bs-theme="dark"] .s5-menu-item { color: #ede9fe; }
[data-bs-theme="dark"] .s5-menu-x { background: rgba(148,163,184,.18); color: #cbd5e1; }
[data-bs-theme="dark"] .s5-sum-modal { background: #14102a; }
[data-bs-theme="dark"] .s5-sum-body { background: #1a1538; }
[data-bs-theme="dark"] .s5-sum-stat { background: #14102a; border-color: rgba(165,243,252,.30); }
[data-bs-theme="dark"] .s5-sum-stat-val { color: #cffafe; }
[data-bs-theme="dark"] .s5-sum-money-row { color: #cffafe; }
[data-bs-theme="dark"] .s5-sum-foot { background: #14102a; border-top-color: rgba(165,243,252,.18); }

@media (max-width: 820px) {
  .s5-tab-row { flex-direction: column; align-items: stretch; }
  .s5-head-right { flex-wrap: wrap; }
}
`;
