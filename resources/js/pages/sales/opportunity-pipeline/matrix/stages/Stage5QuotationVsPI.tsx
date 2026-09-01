import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDmy } from '../../../../../utils/formatDmy';
import { formatProductCode } from '../../../../../utils/formatProductCode';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../../../../api';
import { useToast } from '../../../../../contexts/ToastContext';
import { SHARED_STAGE_CSS, type StageProps } from './stageTypes';
import Tooltip from '../../../../../components/ui/Tooltip';
import SalesDocSendForSignatureModal from './SalesDocSendForSignatureModal';
import { SigningTrackerModal } from '../../SigningTrackerModal';
import ConvertToPiModal, { ConversionBlockedModal } from '../../ConvertToPiModal';
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
 *  Signature). There is deliberately NO Delete — issued quotations and PIs
 *  stay on the opportunity as a record.
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
  return Number.isNaN(d.getTime()) ? '—' : formatDmy(d);
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

export default function Stage5QuotationVsPI({ header, onPrev, onNext, reloadLead, onPiChange, mandatoryIncomplete = false, locked = false }: StageProps) {
  const toast = useToast();
  const leadId = header.leadId ?? null;

  const [docType, setDocType]   = useState<DocType>('quotation');
  /* Starts TRUE: the quotation/PI lists aren't known until the first fetch
   * lands, and `livePisCount`/`locked` are derived from them. If this began
   * false, the very first paint (and the whole loading window) treated the
   * opportunity as having ZERO PIs — so Create PI / Create Quotation looked
   * enabled on a deal that already has a PI (or is already won), and only a
   * refresh corrected it. True here means "checking…" until the data arrives,
   * which also shows the table shimmer on first paint. */
  const [loading, setLoading]   = useState(true);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [pis, setPis]           = useState<PIRow[]>([]);
  const [actingId, setActingId] = useState<number | null>(null);
  // Per-row email in-flight set (decoupled from actingId so two different
  // docs can be emailed at once). `${kind}:${id}` keys; ref mirrors it for a
  // synchronous same-tick double-click guard. See onEmail.
  const [emailingKeys, setEmailingKeys] = useState<Set<string>>(new Set());
  const emailingRef = useRef<Set<string>>(new Set());
  const isEmailing = (kind: DocType, id: number) => emailingKeys.has(`${kind}:${id}`);
  // Convert-to-PI confirmation popup state (target row + previewed PI code).
  const [convertTarget, setConvertTarget] = useState<QuotationRow | null>(null);
  const [convertPreviewCode, setConvertPreviewCode] = useState<string | null>(null);
  // Dedicated "converting to PI" flag. Kept SEPARATE from `actingId` (the
  // document view/download busy state) so the convert flow drives ONLY the
  // modal's own converting spinner — not the "Opening document…" page overlay.
  const [converting, setConverting] = useState(false);
  // Conversion-blocked popup (lead already has a PI): the quotation tried
  // + the existing PI row that blocks it.
  const [convertBlocked, setConvertBlocked] = useState<{ fromQt: string; pi: PIRow } | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  /* The open More-Actions menu — tracks the row + a screen anchor rect so
   * the menu can be portalled to <body> (escaping the table's overflow). */
  const [moreMenu, setMoreMenu] = useState<{ kind: DocType; id: number; anchor: HTMLElement } | null>(null);
  // Which More-Actions item is mid-flight — drives the in-menu spinner so the
  // user sees the View/Download is working (and can't fire it twice).
  const [menuBusy, setMenuBusy] = useState<{ action: 'download' | 'view' | 'certificate'; signature: boolean } | null>(null);

  /* Send-for-Signature modal target + live signature status per row, keyed
   * by `${docType}:${docId}`. The status drives the action-cell control
   * (Send → Awaiting Sign + Remind → Signed + View). */
  const [sigSendFor, setSigSendFor] = useState<
    { kind: DocType; id: number; code: string | null; customerName: string | null } | null
  >(null);
  const [sigByRow, setSigByRow] = useState<Record<string, SigStatusRow>>({});
  /* False until the first signature-status fetch resolves. While loading we DON'T
   * yet know if a doc was already sent/signed, so the Send-for-Signature button
   * shows a loader and is disabled — preventing a premature duplicate send. */
  const [sigLoaded, setSigLoaded] = useState(false);
  // Signing Tracker (shared modal) target — opened from the history icon on any
  // row that has a signature request (sent or signed).
  const [trackerFor, setTrackerFor] = useState<{ sigId: number; code: string } | null>(null);

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
    finally { setSigLoaded(true); }
  }, [leadId, docType]);

  useEffect(() => {
    if (!leadId) return;
    /* New lead / doc-type tab → the previous fetch's status no longer applies.
     * Reset the loader and drop the stale per-row map so the Send-for-Signature
     * button shows the "Checking…" loader (not a stale "Send for Sign") until the
     * fresh status arrives — otherwise an already-signed PI flashes "Send for Sign"
     * for the ~10s the Zoho-sync fetch takes, then snaps to "Signed".
     * The 20s background poll keeps sigLoaded=true, so it never re-flashes. */
    setSigLoaded(false);
    setSigByRow({});
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
    // PIs: "With Signature" opens ONLY the actual Zoho-signed PDF — never the
    // locally rendered preview. If the PI hasn't been signed through Zoho yet
    // there's nothing to show, so warn and stop.
    // Quotations are NOT e-signed through Zoho here, so "With Signature" simply
    // renders the stamped preview variant (the old stamp output).
    if (signature && kind === 'pi') {
      const sig = sigByRow[`${kind}:${id}`];
      if (!sig?.id || sig.status !== 'completed') {
        toast.warning('Not signed yet', 'The signed PDF is available only after the document has been signed via Zoho.');
        return;
      }
    }
    setActingId(id);
    try {
      const sig = sigByRow[`${kind}:${id}`];
      let res;
      if (signature && sig?.id) {
        res = await api.get(`/clm/signature-requests/${sig.id}/view-file/0`, { responseType: 'blob' });
      } else {
        const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
        res = await api.post(url, { signature }, { responseType: 'blob' });
      }
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
    // PIs: "With Signature" downloads ONLY the actual Zoho-signed PDF — never
    // the re-rendered preview. Warn and stop if the PI isn't Zoho-signed yet.
    // Quotations: "With Signature" downloads the stamped preview variant.
    if (signature && kind === 'pi') {
      const sig = sigByRow[`${kind}:${id}`];
      if (!sig?.id || sig.status !== 'completed') {
        toast.warning('Not signed yet', 'The signed PDF is available only after the document has been signed via Zoho.');
        return;
      }
    }
    setActingId(id);
    try {
      const sig = sigByRow[`${kind}:${id}`];
      let res;
      if (signature && sig?.id) {
        res = await api.get(`/clm/signature-requests/${sig.id}/download-file/0`, { responseType: 'blob' });
      } else {
        const url = kind === 'quotation' ? `/sales/quotations/${id}/preview-pdf` : `/sales/proforma-invoices/${id}/preview-pdf`;
        res = await api.post(url, { signature }, { responseType: 'blob' });
      }
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

  /* Convert-to-PI confirmation popup — opens ConvertToPiModal first and
   * only fires the conversion on confirm (mirrors the standalone SalesQPI
   * page so the action behaves identically inside and outside the matrix). */
  const openConvert = (q: QuotationRow) => {
    if (!q.id) return;
    // Block until the PI list has loaded — during the post-refresh load window
    // `pis` is empty, so the "already has a PI" blocker below would falsely pass
    // and let a second PI be created. Guard here too (button is also disabled).
    if (loading) { toast.info('Please wait', 'Still loading this opportunity’s latest status…'); return; }
    // One PI per lead — if a live PI already exists, block conversion and
    // point the user at editing the existing PI (not deleting it).
    const blocker = pis.find(p => (p.status ?? '').toLowerCase() !== 'cancelled');
    if (blocker) {
      setConvertBlocked({ fromQt: q.code ?? '', pi: blocker });
      return;
    }
    setConvertTarget(q);
    setConvertPreviewCode(null);
    api.get('/sales/proforma-invoices/preview-code')
      .then(({ data }) => setConvertPreviewCode(data?.data?.code ?? null))
      .catch(() => setConvertPreviewCode(null));
  };

  const confirmConvert = async () => {
    const q = convertTarget;
    if (!q || !q.id) return;
    setConverting(true);
    try {
      const { data } = await api.post<{ status: boolean; data?: { code?: string } }>(
        `/sales/proforma-invoices/from-quotation/${q.id}`,
      );
      const code = data?.data?.code ?? 'PI';
      await fetchAll(true);
      setDocType('pi');
      toast.success('Converted to PI', `New proforma invoice ${code} created from ${q.code ?? 'this quotation'}.`);
      onPiChange?.();
      // The conversion verified this QUOTATION's consignee documents and then
      // froze that consignee onto the lead. Reload the header so the left
      // Consignee Details card + every later form show the frozen party.
      void reloadLead?.();
      setConvertTarget(null);
    } catch (e: any) {
      // Covers the DCP block too: the server returns 422 with the exact list
      // of documents still pending for this quotation's customer / consignee.
      toast.error('Conversion blocked', e?.response?.data?.message ?? 'Could not convert this quotation to a PI.');
      // The server rejected because the state changed under us — e.g. another
      // tab already converted this lead. Refresh so the row reflects reality
      // immediately: the Convert-to-PI button disables and the PI count updates
      // without needing a manual page refresh.
      await fetchAll(true);
      setConvertTarget(null);   // close the confirm modal
    } finally {
      setConverting(false);
    }
  };

  const onEmail = async (kind: DocType, id: number, code: string | null) => {
    const key = cdKey(kind, id);
    // Per-row send: only block a repeat of THIS row (its button is disabled
    // while in flight; the ref catches a same-tick double-click). A DIFFERENT
    // quotation/PI can be emailed at the same time.
    if (emailingRef.current.has(key)) return;
    // Still cooling down from a previous rate-limit hit — surface the wait.
    const left = cooldownLeft(kind, id);
    if (left > 0) {
      toast.warning('Please wait', `You can email this ${kind === 'pi' ? 'PI' : 'quotation'} again in ${left}s (max 3 per minute).`);
      return;
    }
    emailingRef.current.add(key);
    setEmailingKeys(s => new Set(s).add(key));
    try {
      const url = kind === 'quotation' ? `/sales/quotations/${id}/email` : `/sales/proforma-invoices/${id}/email`;
      await api.post(url, {});
      toast.success('Email sent', `${code ?? 'Document'} was emailed to the customer.`);
    } catch (e: any) {
      // 429 = throttle (max 3 sends per doc per minute). Not a real failure —
      // tell the user to wait, and start the cooldown so the button locks.
      if (e?.response?.status === 429) {
        const wait = Number(e?.response?.data?.retry_after_seconds) || 60;
        setEmailCooldowns(m => ({ ...m, [cdKey(kind, id)]: Date.now() + wait * 1000 }));
        toast.warning('Please wait', e?.response?.data?.message ?? `Too many attempts — try again in ${wait}s.`);
      } else {
        toast.error('Email failed', e?.response?.data?.message ?? 'Could not send the email — check the customer contact details.');
      }
    } finally {
      emailingRef.current.delete(key);
      setEmailingKeys(s => { const n = new Set(s); n.delete(key); return n; });
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
    /* Nothing is editable until we know whether it has been sent or signed.
       The lock further down reads sigByRow, which is empty for the few seconds
       the signature fetch takes — so on every page load an already-sent PI was
       editable for that window, and the guard that should have stopped it had
       nothing to read yet.
       The Send button already waited on this flag (it shows "Checking…").
       Edit did not, which is why one was safe and the other was not. */
    if (!sigLoaded) {
      toast.info('Checking signature status', 'One moment — confirming whether this document has already been sent for signature.');
      return;
    }

    // A quotation that's been converted to a PI (or cancelled) is locked — the
    // PI is now the live document; editing the quotation would desync them.
    if (kind === 'quotation') {
      const q = quotations.find(x => x.id === id);
      if (q && isTerminalQuote(q.status)) {
        const cancelled = String(q.status).toLowerCase().includes('cancel');
        toast.warning(
          cancelled ? 'Quotation cancelled' : 'Quotation converted to PI',
          cancelled
            ? 'This quotation is cancelled and can no longer be edited.'
            : 'This quotation has been converted to a Proforma Invoice and can no longer be edited. Edit the PI instead.',
        );
        return;
      }
    }
    const st = sigByRow[`${kind}:${id}`]?.status;
    // A signed document is locked — the signed copy must keep matching what the
    // customer e-signed. A PI that's been SENT for signature (awaiting) is also
    // locked so it can't drift from what was sent. Block and explain why.
    if (st === 'completed' || (kind === 'pi' && st === 'inprogress')) {
      toast.warning(
        kind === 'pi' ? (st === 'inprogress' ? 'PI sent for signature' : 'PI already signed') : 'Quotation already signed',
        kind === 'pi' && st === 'inprogress'
          ? 'This PI has been sent for signature and can no longer be edited until signing is resolved.'
          : `This ${kind === 'pi' ? 'PI' : 'quotation'} has already been signed and can no longer be edited. Duplicate it to make changes.`,
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
    // Stage 6 (Victory) needs a Proforma Invoice that has been SIGNED.
    // Quick client-side check for the PI; the signed check is enforced
    // server-side and its message surfaces via the catch below.
    if (livePisCount === 0) {
      toast.warning('Create a PI first', 'Moving to Victory (Stage 6) needs a Proforma Invoice on this opportunity — a quotation alone isn’t enough.');
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

  /* Email rate-limit cooldown — server caps sends at 3 per doc per minute
   * (429). Keep that row's Email button disabled-looking until it frees.
   * Keyed by `${kind}:${id}` → epoch-ms; a 1s ticker re-renders the countdown. */
  const [emailCooldowns, setEmailCooldowns] = useState<Record<string, number>>({});
  const cdKey = (kind: DocType, id: number) => `${kind}:${id}`;
  const cooldownLeft = (kind: DocType, id: number): number => {
    const end = emailCooldowns[cdKey(kind, id)];
    return end ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : 0;
  };
  useEffect(() => {
    if (Object.keys(emailCooldowns).length === 0) return;
    const t = setInterval(() => {
      setEmailCooldowns(m => {
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const [k, v] of Object.entries(m)) if (v > now) next[k] = v;
        return Object.keys(next).length === Object.keys(m).length ? m : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [emailCooldowns]);

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

  /* ── Mandatory-doc gate for Create PI ──────────────────────────────
   * A PI can't be created until every MANDATORY KYC / Due-Diligence /
   * Trade-Licence doc for the customer AND the chosen consignee is uploaded.
   * The check is split across three points because the consignee isn't known
   * until the PI form itself (quotations may each name a different one):
   *   1. HERE — `mandatoryIncomplete`, the CUSTOMER's tally, derived by the
   *      parent (SalesMatrixDetail) from the vault fetch it already makes for
   *      the left "Customer Details" card. Greys the Create PI button.
   *   2. Create-PI wizard, Step 1 → Step 2 — probes
   *      /sales/proforma-invoices/party-docs-check for the customer + the
   *      just-picked consignee.
   *   3. The server, on save / convert — the authoritative gate.
   * Trade documents are intentionally EXCLUDED at every point. */

  const colSpan = docType === 'quotation' ? 7 : 9;

  return (
    <>
      <style>{SHARED_STAGE_CSS}{STAGE5_CSS}</style>

      {/* Full-page lock while a document is opening (view / download / email /
          certificate). Portalled to <body> and fixed over the WHOLE viewport so
          it also covers the step pills and action buttons OUTSIDE this stage —
          no stage-switch or any other action can fire until the doc is ready. */}
      {(anyActing || menuBusy) && createPortal(
        <div className="s5-pagelock" role="status" aria-live="polite" aria-label="Opening document">
          <div className="s5-pagelock-card">
            <span className="s5-pagelock-spin" />
            <span className="s5-pagelock-txt">Opening document…</span>
          </div>
        </div>,
        document.body,
      )}

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
            <div className="smd-stg-head-sub">
              {docType === 'quotation'
                ? `● ${liveQuotationsCount} ${liveQuotationsCount === 1 ? 'Quotation' : 'Quotations'} on this opportunity`
                : `● ${livePisCount} ${livePisCount === 1 ? 'Proforma Invoice' : 'Proforma Invoices'} on this opportunity`}
            </div>
          </div>
        </div>
        <div className="s5-head-right">
          <span className="smd-stg-head-badge">ACTIVE</span>
          <span className="s5-head-divider" />
          <button type="button" className="s5-summary-btn" onClick={() => setSummaryOpen(true)} disabled={anyActing} title={anyActing ? 'Please wait — an action is in progress…' : undefined}>
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
              disabled={anyActing}
              title={anyActing ? 'Please wait — an action is in progress…' : undefined}
            >
              <span className="s5-seg-dot" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
              <span>Quotation</span>
              <span className="s5-seg-count">{liveQuotationsCount}</span>
            </button>
            <button
              type="button"
              className={`s5-seg-btn ${docType === 'pi' ? 'active' : ''}`}
              onClick={() => setDocType('pi')}
              disabled={anyActing}
              title={anyActing ? 'Please wait — an action is in progress…' : undefined}
            >
              <span className="s5-seg-dot" />
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>
              </svg>
              <span>Proforma Invoice</span>
              <span className="s5-seg-count">{livePisCount}</span>
            </button>
          </div>
          <div className="s5-create-group">
            {/* Once a (non-cancelled) PI exists on this opportunity, a new
                Quotation can no longer be created against it — the button stays
                visible but greyed; clicking explains why. Also locked once signed. */}
            <button
              type="button"
              className="s5-create-btn s5-create-q"
              // HARD-disable while the opportunity's latest quotation/PI status is
              // still loading (or an action is mid-flight). The onClick guard alone
              // left the button clickable during the ~2-3s post-refresh load window,
              // so a user could fire Create before livePisCount hydrated → duplicate.
              disabled={loading || anyActing}
              style={(loading || anyActing || locked || livePisCount > 0) ? { opacity: 0.5, cursor: (loading || anyActing) ? 'wait' : 'not-allowed' } : undefined}
              title={anyActing ? 'Please wait — an action is in progress…' : loading ? 'Checking the latest quotation / PI status…' : locked ? 'Locked — the Proforma Invoice has been signed' : (livePisCount > 0 ? 'A Proforma Invoice already exists for this opportunity' : undefined)}
              onClick={() => {
                // Block while a row action (PDF view/download/email) is in flight
                // so a second action can't fire mid-load.
                if (anyActing) { toast.info('Please wait', 'An action is already in progress.'); return; }
                // Block until the first fetch resolves — acting on the empty
                // initial state let a duplicate slip through on a slow API.
                if (loading) { toast.info('Please wait', 'Still loading this opportunity’s latest status…'); return; }
                if (locked) { toast.warning('Deal locked', 'The Proforma Invoice is signed — this opportunity is read-only.'); return; }
                if (livePisCount > 0) { toast.warning('PI already created', 'A Proforma Invoice already exists for this opportunity — you cannot create a new quotation against it.'); return; }
                onCreate('quotation');
              }}>
              {loading
                ? <span className="s5-icn-spin" role="status" aria-label="Loading latest status…" />
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
              {loading ? 'Loading…' : 'Create Quotation'}
            </button>
            <span className="s5-create-div" />
            {/* One PI per opportunity: once a (non-cancelled) PI exists the
                Create PI button stays VISIBLE but greyed; clicking it explains
                why instead of opening the form. Also locked once the PI is signed. */}
            <button
              type="button"
              className="s5-create-btn s5-create-p"
              // HARD-disable during the load window (and while acting) so a fast
              // click right after refresh can't create a second PI before the
              // existing-PI status has hydrated. Business-rule cases (already has
              // PI / locked / docs pending) stay soft so their "why" toast shows.
              disabled={loading || anyActing}
              style={(loading || anyActing || locked || livePisCount > 0 || mandatoryIncomplete) ? { opacity: 0.5, cursor: (loading || anyActing) ? 'wait' : 'not-allowed' } : undefined}
              title={anyActing ? 'Please wait — an action is in progress…' : loading ? 'Checking the latest quotation / PI status…' : undefined}
              onClick={() => {
                // Block while a row action (PDF view/download/email) is in flight.
                if (anyActing) { toast.info('Please wait', 'An action is already in progress.'); return; }
                // Block until the first fetch resolves — otherwise a second PI
                // could be created on a won deal while the list was still loading.
                if (loading) {
                  toast.info('Please wait', 'Still loading this opportunity’s latest status…');
                  return;
                }
                if (locked) {
                  toast.warning('Deal locked', 'The Proforma Invoice is signed — this opportunity is read-only.');
                  return;
                }
                if (livePisCount > 0) {
                  toast.warning('Only one PI per opportunity', 'A single lead can have only one Proforma Invoice.');
                  return;
                }
                if (mandatoryIncomplete) {
                  toast.warning('Standard documents pending', 'Upload all Standard Documents (KYC, Due Diligence & Licences) for the customer to 100% before creating a PI. The consignee’s documents are checked once you pick it inside the form.');
                  return;
                }
                onCreate('pi');
              }}
            >
              {loading
                ? <span className="s5-icn-spin" role="status" aria-label="Loading latest status…" />
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
              {loading ? 'Loading…' : 'Create PI'}
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
                  // One PI per lead: once ANY quotation on this opportunity has been
                  // converted (a PI exists), every OTHER quotation's Convert-to-PI
                  // and Edit actions are locked too — not just blocked on click.
                  const piLocked = docType === 'quotation' && livePisCount > 0;
                  return (
                    <tr key={r.id} className={anyActing && actingId === r.id ? 's5-row-acting' : undefined}>
                      <td className="ta-c"><span className="s5-sr2">{idx + 1}</span></td>
                      {/* Document number is a plain LABEL, not a link — clicking
                          it used to open the edit form, which was too easy to
                          trigger while just reading the row. Editing is the
                          pencil action only. */}
                      <td>
                        <span className="s5-qno">{r.code ?? `#${r.id}`}</span>
                      </td>
                      {/* nowrap: the header row already has it, the body
                          did not — and browsers break a line AFTER a
                          hyphen, so "10-Aug-2026" split into three lines
                          inside a 120px column that it actually fits in. */}
                      <td className="s5-muted s5-nowrap">{fmtDate(r.created_at)}</td>
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
                            /* Same window as the Edit guard: until the fetch
                               lands there is no status to read, and falling
                               through to "Not Sent" told the user the opposite
                               of the truth about a document already sent. */
                            if (!sigLoaded) {
                              return <span className="s5-st-badge s5-st-notsent" style={{ opacity: .7 }}>Checking…</span>;
                            }
                            const st = sigByRow[`${docType}:${r.id}`]?.status;
                            // Clean solid pill — same shape as the Document Type
                            // badge (s5-dt2), just colour-coded by signature state.
                            if (st === 'completed') {
                              return <span className="s5-st-badge s5-st-signed">Signed</span>;
                            }
                            if (st === 'inprogress') {
                              return <span className="s5-st-badge s5-st-sent">Sent</span>;
                            }
                            // Declined / recalled read as such until re-sent (then
                            // sigByRow flips to inprogress → "Sent").
                            if (st === 'declined') {
                              return <span className="s5-st-badge s5-st-declined">Declined</span>;
                            }
                            if (st === 'recalled') {
                              return <span className="s5-st-badge s5-st-recalled">Recalled</span>;
                            }
                            if (st === 'expired') {
                              return <span className="s5-st-badge s5-st-recalled">Expired</span>;
                            }
                            /* No request at all — nothing has been sent. */
                            if (!st) {
                              return <span className="s5-st-badge s5-st-notsent">Not Sent</span>;
                            }
                            /* A request EXISTS but Zoho returned a state this
                               screen does not know — an undelivered / bounced
                               mail is one of them, and Zoho's raw value is
                               stored as-is (see show() in
                               ClmSignatureController).
                               Showing Zoho's own word is the only honest option:
                               falling through to "Not Sent" denied a request
                               that had been sent, and there is no basis for
                               calling it "Declined" — nobody refused anything.
                               Title-cased so "undelivered" reads as
                               "Undelivered". */
                            return (
                              <span
                                className="s5-st-badge s5-st-recalled"
                                title={`Signature request state reported by Zoho: ${st}`}
                              >
                                {st.charAt(0).toUpperCase() + st.slice(1)}
                              </span>
                            );
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
                                type="button" className="s5-convert2"
                                title={piLocked ? 'A Proforma Invoice already exists — only one PI per lead' : 'Convert to PI'}
                                onClick={() => { if (loading || piLocked) return; openConvert(r as QuotationRow); }}
                                disabled={anyActing || piLocked || loading}
                                style={piLocked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                                </svg>
                                Convert to PI
                              </button>
                            )
                          )}
                          {/* Send for Signature (Zoho Sign) — PI ONLY.
                              Quotations are not e-signed through Zoho here, so the
                              Send/Sent/Signed pill is hidden on the Quotation tab
                              (matches the standalone Quotations V/S PI page).
                              Status-aware: Send → Awaiting Sign (+Remind) → Signed. */}
                          {docType === 'pi' && (() => {
                            // Still loading signature status → show a disabled
                            // loader so the user can't fire a premature send
                            // before we know whether it's already sent/signed.
                            if (!sigLoaded) {
                              return (
                                <button type="button" className="s5-convert2" disabled
                                  style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', opacity: 1, cursor: 'wait' }}>
                                  <span className="s5-sig-spin" /> Checking…
                                </button>
                              );
                            }
                            const sig = sigByRow[`${docType}:${r.id}`];
                            const st  = sig?.status;
                            if (st === 'inprogress') {
                              return (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  {/* Already sent → the STATUS column already shows the
                                      "Sent" badge, so we DON'T repeat a locked "Sent"
                                      button here (it read as "click to send again").
                                      Only the useful actions remain: View the sent
                                      document + Remind the signer. */}
                                  <Tooltip label="View sent document">
                                    {/* The doc sent to Zoho for an in-progress PI is the
                                        locally rendered PI PDF, not a signed artifact — so
                                        view it with signature=false (the signed-only guard
                                        would otherwise bounce every in-progress row with a
                                        "Not signed yet" toast and open nothing). */}
                                    <button type="button" className="s5-icn" onClick={() => void onViewPdf(docType, r.id, false)} disabled={anyActing}>
                                      {/* Spinner while the sent document is being fetched/opened
                                          so the click isn't silent on slow networks (QA #66). */}
                                      {actingId === r.id
                                        ? <span className="s5-icn-spin" role="status" aria-label="Opening document…" />
                                        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                                    </button>
                                  </Tooltip>
                                  <Tooltip label="Send signing reminder">
                                    <button type="button" className="s5-icn" onClick={() => void onRemindSig(sig!.id)} disabled={anyActing}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                                    </button>
                                  </Tooltip>
                                </span>
                              );
                            }
                            if (st === 'completed') {
                              // Signed → green "Signed" pill (locked). View/Download
                              // the signed copy lives in the 3-dot menu.
                              return (
                                <button type="button" className="s5-convert2" title="Document already signed — open More Actions to view it" disabled
                                  style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', boxShadow: '0 2px 8px rgba(22,163,74,.3)', opacity: 1, cursor: 'not-allowed' }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                  Signed
                                </button>
                              );
                            }
                            // Declined / recalled → the PI was already sent, so
                            // the button re-sends (warm red-orange to distinguish
                            // it from a first-time blue "Send for Sign").
                            const declined = st === 'declined' || st === 'recalled';
                            return (
                              <button
                                type="button" className="s5-convert2"
                                title={declined ? (st === 'recalled' ? 'Recalled — re-send for signature' : 'Declined — re-send for signature') : 'Send for Signature'}
                                onClick={() => setSigSendFor({ kind: docType, id: r.id, code: r.code, customerName: r.customer?.company_name ?? null })}
                                disabled={anyActing}
                                style={{ background: declined ? 'linear-gradient(135deg,#f97316,#dc2626)' : 'linear-gradient(135deg,#0ea5e9,#0284c7)' }}
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
                                {declined ? 'Resend for Sign' : 'Send for Sign'}
                              </button>
                            );
                          })()}
                          {/* Signing Tracker — PI ONLY (quotations have no signing
                              flow here). Appears once a PI has been sent for
                              signature; opens the shared activity-timeline modal. */}
                          {docType === 'pi' && (() => {
                            const sig = sigByRow[`${docType}:${r.id}`];
                            if (!sig?.id) return null;
                            return (
                              <Tooltip label="Signing activity tracker">
                                <button type="button" className="s5-icn" onClick={() => setTrackerFor({ sigId: sig.id, code: r.code ?? `${titleCase(docType)} #${r.id}` })} disabled={anyActing}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                                </button>
                              </Tooltip>
                            );
                          })()}
                          <span className="s5-act-sep" />
                          {/* Email button shown for BOTH Quotations and PIs. It
                              stays available after every send (no one-time hide)
                              so the document can be re-emailed to the customer
                              as many times as needed; each send fires a toast. */}
                          <Tooltip label={cooldownLeft(docType, r.id) > 0 ? `Please wait ${cooldownLeft(docType, r.id)}s (max 3 per minute)` : 'Send via Email'}>
                            <button type="button"
                              className={`s5-icn s5-icn-mail${cooldownLeft(docType, r.id) > 0 ? ' s5-icn-cooling' : ''}`}
                              // Also blocked while any row action (e.g. opening a
                              // PDF) is in flight, so no second action fires mid-view.
                              onClick={() => void onEmail(docType, r.id, r.code)} disabled={anyActing || isEmailing(docType, r.id)}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            </button>
                          </Tooltip>
                          {(() => {
                            // Editing is locked once the doc is signed, and for a
                            // PI also once it's been SENT for signature (awaiting).
                            // Pencil greys out; clicking still explains why (onEdit).
                            const st = sigByRow[`${docType}:${r.id}`]?.status;
                            // Quotation converted to a PI (terminal) is locked too —
                            // the PI is the live doc now.
                            const convertedLock = docType === 'quotation' && terminal;
                            /* Locked until the signature status is known.
                               `st` is undefined for the few seconds the signature
                               fetch takes, so every lock below evaluated false and
                               the pencil rendered fully enabled on an already-sent
                               PI — for the whole load window. onEdit refused the
                               click, but the button still LOOKED editable, which is
                               the half of the bug the user actually sees.
                               The Send button already greys out over the same
                               window ("Checking…"); Edit now matches it. */
                            const locked = !sigLoaded || st === 'completed' || (docType === 'pi' && st === 'inprogress') || convertedLock || piLocked;
                            const lockLabel = !sigLoaded
                              ? 'Checking signature status…'
                              : convertedLock
                              ? (String(r.status).toLowerCase().includes('cancel') ? 'Quotation cancelled — editing locked' : 'Quotation converted to PI — editing locked')
                              : piLocked
                              ? 'A Proforma Invoice already exists — quotations are locked'
                              : docType === 'pi'
                              ? (st === 'inprogress' ? 'PI sent for signature — editing locked' : 'PI signed — editing locked')
                              : 'Quotation signed — editing locked';
                            return (
                              <Tooltip label={locked ? lockLabel : 'Edit'}>
                                <button
                                  type="button" className="s5-icn s5-icn-edit"
                                  // piLocked quotations (a PI already exists), and rows
                                  // whose signature status hasn't loaded, can't be
                                  // opened at all;
                                  // signed/converted still call onEdit so it can
                                  // explain why via a toast.
                                  onClick={() => { if (piLocked || !sigLoaded) return; onEdit(docType, r.id); }} disabled={anyActing || piLocked || !sigLoaded}
                                  style={locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                              </Tooltip>
                            );
                          })()}
                          <Tooltip label="More Actions">
                            <button
                              type="button" className="s5-icn s5-icn-more"
                              onClick={(e) => {
                                // Keep the button ELEMENT (not a frozen rect) so the
                                // menu can re-measure and stay glued to it while the
                                // stage scrolls.
                                const el = e.currentTarget as HTMLButtonElement;
                                setMoreMenu(prev => prev && prev.id === r.id && prev.kind === docType ? null : { kind: docType, id: r.id, anchor: el });
                              }}
                              disabled={anyActing}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>
                            </button>
                          </Tooltip>
                          {/* No Delete action — a quotation and a PI are issued
                              business documents with downstream links (PI →
                              procurement / shipment, signature requests, the
                              lead's frozen consignee), so they are never removed
                              from an opportunity. Supersede a quotation by
                              raising a new one instead. */}
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
          anchorEl={moreMenu.anchor}
          kind={moreMenu.kind}
          busy={menuBusy}
          // Don't let an outside-click / scroll close the menu while an action
          // is still loading — the spinner must stay visible until it finishes.
          onClose={() => { if (!menuBusy) setMoreMenu(null); }}
          onPick={async (action, signature) => {
            if (menuBusy) return;
            const id = moreMenu.id, kind = moreMenu.kind;
            const code = (kind === 'quotation' ? quotations : pis).find(x => x.id === id)?.code ?? null;
            setMenuBusy({ action, signature });
            try {
              if (action === 'download') await onDownloadPdf(kind, id, code, signature);
              else                        await onViewPdf(kind, id, signature);
            } finally {
              setMenuBusy(null);
              setMoreMenu(null);
            }
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
          /* Passed in BOTH create and edit mode (unlike initialOpp) so the
             wizard knows whether this lead's consignee is already frozen. */
          leadConsigneeId={header.consigneeId ?? null}
          onClose={() => { setCreateQtOpen(false); setEditQtId(null); }}
          onSubmit={() => {
            setCreateQtOpen(false); setEditQtId(null);
            void fetchAll(true);
            // A quotation also unlocks the Segment Details card (segments
            // derive from its mapped products), so refresh the parent's
            // agreement-applicable fetch.
            onPiChange?.();
            // A quotation does NOT map its consignee onto the lead — each
            // quotation on this opportunity may name a different one, and
            // only a PI freezes the deal's final consignee. The reload is
            // just to keep the header in sync with any other lead edits.
            void reloadLead?.();
          }}
        />
      )}
      {createPiOpen && (
        <CreatePIModal
          editId={editPiId}
          source={piSource}
          initialOpp={editPiId == null && !piSource ? initialOpp : undefined}
          leadConsigneeId={header.consigneeId ?? null}
          onClose={() => { setCreatePiOpen(false); setEditPiId(null); setPiSource(null); }}
          onSubmit={() => {
            setCreatePiOpen(false);
            setEditPiId(null);
            setPiSource(null);
            void fetchAll(true);
            onPiChange?.();
            // Creating a PI FREEZES its consignee onto the lead (server-side,
            // in the same transaction). Reload the header so the now-frozen
            // consignee renders read-only in every later form on this deal.
            void reloadLead?.();
          }}
        />
      )}

      {/* Signing activity tracker (shared modal). */}
      {trackerFor && (
        <SigningTrackerModal
          sigId={trackerFor.sigId}
          code={trackerFor.code}
          onClose={() => setTrackerFor(null)}
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

      {/* Convert-to-PI confirmation popup. */}
      <ConvertToPiModal
        open={!!convertTarget}
        fromQuotation={convertTarget?.code ?? ''}
        newPiCode={convertPreviewCode}
        piDate={formatDmy(new Date())}
        quotationValue={convertTarget ? `${ccyCode(convertTarget.currency)} ${fmtNum(convertTarget.grand_total)}` : '—'}
        converting={converting}
        onCancel={() => { if (actingId === null) setConvertTarget(null); }}
        onConfirm={() => void confirmConvert()}
      />

      {/* Conversion blocked — lead already has a PI. */}
      <ConversionBlockedModal
        open={!!convertBlocked}
        fromQuotation={convertBlocked?.fromQt ?? ''}
        existingPiCode={convertBlocked?.pi.code ?? ''}
        existingPiDate={convertBlocked ? fmtDate(convertBlocked.pi.created_at) : null}
        existingPiFromQuotation={
          convertBlocked?.pi.source_quotation_id != null
            ? (quotationCodeById.get(convertBlocked.pi.source_quotation_id) ?? null)
            : null
        }
        onClose={() => setConvertBlocked(null)}
        onViewExistingPi={() => { setConvertBlocked(null); setDocType('pi'); }}
      />
    </>
  );
}

/* ─── More Actions menu — fixed-position portal anchored to the 3-dot
 *      button. Download / View, each With / Without Signature. */
function MoreActionsMenu({ anchorEl, onClose, onPick, busy, kind }: {
  anchorEl: HTMLElement;
  onClose: () => void;
  onPick: (action: 'download' | 'view', signature: boolean) => void;
  busy: { action: 'download' | 'view' | 'certificate'; signature: boolean } | null;
  kind: DocType;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>(() => {
    const a = anchorEl.getBoundingClientRect();
    return { top: a.bottom + 6, left: a.right - 210 };
  });

  // Keep the menu GLUED to the 3-dot button under ANY layout change — page or
  // nested-container scroll, resize, table reflow, the background signature
  // refresh, even the open animation settling — by re-measuring the LIVE anchor
  // rect every animation frame while open. Scroll/resize listeners alone missed
  // reflows that move the row without a scroll event, so the menu drifted off
  // the button (QA #44). setPos only fires when the position actually changes,
  // so idle frames cost a single measurement.
  useLayoutEffect(() => {
    let raf = 0;
    let last = { top: NaN, left: NaN };
    const tick = () => {
      const a = anchorEl.getBoundingClientRect();
      // A background re-render can detach the captured button node; its rect
      // then collapses to 0×0. Hold the last good spot on those frames instead
      // of snapping the menu to the corner.
      if (a.width || a.height) {
        const w = ref.current?.offsetWidth ?? 210;
        const h = ref.current?.offsetHeight ?? 230;
        let left = a.right - w;
        let top = a.bottom + 6;
        if (left < 8) left = 8;
        if (top + h > window.innerHeight - 8) top = a.top - h - 6;   // flip above
        if (top !== last.top || left !== last.left) {
          last = { top, left };
          setPos({ top, left });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anchorEl]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    /* Close on background scroll instead of chasing it. The rAF loop above kept
       the menu glued to the button while the page/table scrolled, but that
       re-positions through React state every frame, so it visibly trailed the
       scroll (the "not smooth" jank). Dismissing on scroll — the standard
       action-menu behaviour — removes the jank entirely. A scroll INSIDE the
       menu is ignored, and onClose no-ops while an action is in flight. */
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
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
  const spin = <span className="s5-menu-spin" />;

  const anyBusy = !!busy;
  const isBusy = (action: 'download' | 'view' | 'certificate', signature: boolean) =>
    !!busy && busy.action === action && busy.signature === signature;

  return createPortal(
    <div ref={ref} className={`s5-menu${anyBusy ? ' is-busy' : ''}`} style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
      <div className="s5-menu-head">
        <div className="s5-menu-head-left">
          <span className="s5-menu-head-ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><circle cx="12" cy="5" r="1" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#fff"/><circle cx="12" cy="19" r="1" fill="#fff"/></svg></span>
          More Actions
        </div>
        <button type="button" className="s5-menu-x" onClick={onClose} aria-label="Close" disabled={anyBusy}>✕</button>
      </div>
      <div className="s5-menu-body">
        {/* Quotations are never e-signed through Zoho here, so the With/Without
            Signature split is meaningless for them — show a single plain
            Download + View. The signature variants stay for PIs only. */}
        {kind === 'quotation' ? (
          <>
            <div className="s5-menu-sec s5-menu-sec-dl">⬇ Download</div>
            <button type="button" className="s5-menu-item s5-mi-dl" disabled={anyBusy} onClick={() => onPick('download', false)}><span className="s5-mi-ico">{isBusy('download', false) ? spin : dl}</span>Download</button>
            <div className="s5-menu-div" />
            <div className="s5-menu-sec s5-menu-sec-vw">👁 View</div>
            <button type="button" className="s5-menu-item s5-mi-vw" disabled={anyBusy} onClick={() => onPick('view', false)}><span className="s5-mi-ico">{isBusy('view', false) ? spin : eye}</span>View</button>
          </>
        ) : (
          <>
            <div className="s5-menu-sec s5-menu-sec-dl">⬇ Download</div>
            <button type="button" className="s5-menu-item s5-mi-dl" disabled={anyBusy} onClick={() => onPick('download', true)}><span className="s5-mi-ico">{isBusy('download', true) ? spin : dl}</span>With Signature</button>
            <button type="button" className="s5-menu-item s5-mi-dl" disabled={anyBusy} onClick={() => onPick('download', false)}><span className="s5-mi-ico">{isBusy('download', false) ? spin : dl}</span>Without Signature</button>
            <div className="s5-menu-div" />
            <div className="s5-menu-sec s5-menu-sec-vw">👁 View</div>
            <button type="button" className="s5-menu-item s5-mi-vw" disabled={anyBusy} onClick={() => onPick('view', true)}><span className="s5-mi-ico">{isBusy('view', true) ? spin : eye}</span>With Signature</button>
            <button type="button" className="s5-menu-item s5-mi-vw" disabled={anyBusy} onClick={() => onPick('view', false)}><span className="s5-mi-ico">{isBusy('view', false) ? spin : eye}</span>Without Signature</button>
          </>
        )}
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
  // Which row+action (view vs download) is mid-flight — drives the per-button
  // spinner so the user can see the PDF is opening / downloading.
  const [pdfBusy, setPdfBusy] = useState<{ id: number; download: boolean } | null>(null);

  // Block closing (X / Close button / Escape) while a PDF is opening or
  // downloading — on the server the fetch can take a moment, and letting the
  // popup close mid-flight leaves the in-flight request acting on an unmounted
  // modal. The close controls disable until the PDF settles.
  const guardedClose = () => { if (!pdfBusy) onClose(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pdfBusy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pdfBusy]);

  /* Lock background page scroll while the popup is open. */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

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
  // Price colour convention across this popup: quoted ABOVE target is unfavorable
  // → red; quoted BELOW target is favorable → green; EQUAL → neutral. Applies to
  // the per-row Quoted amount, Total Quoted, the Variance figure, and the ▲/▼ badge.
  const cmpClass        = (q: number, t: number) => (q > t ? 'c-red' : q < t ? 'c-green' : 'c-neutral');
  const totalQuotedClass = cmpClass(totalQuoted, totalTarget);
  const varTextClass    = variance > 0 ? 'c-red' : variance < 0 ? 'c-green' : 'c-neutral';
  const varBgClass      = variance > 0 ? 's5-ps-stat-red' : variance < 0 ? 's5-ps-stat-grn' : 's5-ps-stat-neu';

  const today = new Date();
  const asOf = formatDmy(today);

  const pdf = async (entryId: number, download: boolean) => {
    // Ignore new clicks while a PDF is already opening/downloading — one at a
    // time keeps the busy state (and the close guard) unambiguous.
    if (pdfBusy) return;
    setActingId(entryId);
    setPdfBusy({ id: entryId, download });
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
      setPdfBusy(null);
    }
  };

  const fmtRowDate = (s: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
    return {
      date: formatDmy(d),
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
          'Product Code': formatProductCode(r.product_code) || `P-${String(r.product_id ?? 0).padStart(3, '0')}`,
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
    <div className="s5-ps-backdrop">
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
            <button type="button" className="s5-ps-x" onClick={guardedClose} disabled={!!pdfBusy} aria-label="Close" title={pdfBusy ? 'Please wait — the PDF is still opening' : 'Close'} style={pdfBusy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>×</button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="s5-ps-stats">
          <div className="s5-ps-stat s5-ps-stat-tint"><div className="s5-ps-stat-lbl">Total Products</div><div className="s5-ps-stat-val c-cyan">{latest.length} items</div></div>
          <div className="s5-ps-stat"><div className="s5-ps-stat-lbl">Total Quantity</div><div className="s5-ps-stat-val c-cyan">{totalQty.toLocaleString()} units</div></div>
          <div className="s5-ps-stat s5-ps-stat-tint"><div className="s5-ps-stat-lbl">Total Target</div><div className="s5-ps-stat-val c-blue">{money(totalTarget, ccy)}</div></div>
          <div className="s5-ps-stat"><div className="s5-ps-stat-lbl">Total Quoted</div><div className={`s5-ps-stat-val ${totalQuotedClass}`}>{money(totalQuoted, ccy)}</div></div>
          <div className={`s5-ps-stat ${varBgClass}`}>
            <div className="s5-ps-stat-lbl">Variance</div>
            {/* Quoted ABOVE target = green, BELOW = red, EQUAL = neutral. */}
            <div className={`s5-ps-stat-val ${varTextClass}`}>{over ? '+' : ''}{variance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({variancePct}%)</div>
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
                    <td><code className="s5-ps-code">{formatProductCode(r.product_code) || `P-${String(r.product_id ?? 0).padStart(3, '0')}`}</code></td>
                    <td>
                      <Tooltip label={r.product_name ?? ''}>
                        <div className="s5-ps-name">{r.product_name ?? '—'}</div>
                      </Tooltip>
                    </td>
                    <td><div className="s5-ps-date">{date}</div>{time && <div className="s5-ps-time">{time}</div>}</td>
                    <td className="ta-r s5-ps-qty">{r.quantity != null ? Number(r.quantity).toLocaleString() : '—'}</td>
                    <td className="ta-r"><div className="s5-ps-target">{money(tp, r.currency)}</div></td>
                    <td className="ta-r">
                      <div className={`s5-ps-quoted ${cmpClass(qp, tp)}`}>{money(qp, r.currency)}</div>
                      {diff !== 0 && (
                        <span className={`s5-ps-diff ${rOver ? 'over' : 'under'}`}>{rOver ? '▲' : '▼'} {sym(r.currency)}{Math.abs(diff).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      )}
                    </td>
                    <td className="ta-c">
                      <div className="s5-ps-acts">
                        <button type="button" className="s5-ps-act" title="View" disabled={actingId !== null} onClick={() => void pdf(r.id, false)}>
                          {pdfBusy && pdfBusy.id === r.id && !pdfBusy.download
                            ? <span className="s5-ps-spin" />
                            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                        </button>
                        <button type="button" className="s5-ps-act s5-ps-act-dl" title="Download" disabled={actingId !== null} onClick={() => void pdf(r.id, true)}>
                          {pdfBusy && pdfBusy.id === r.id && pdfBusy.download
                            ? <span className="s5-ps-spin" />
                            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
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
            <button type="button" className="s5-ps-export" disabled={loading || latest.length === 0 || !!pdfBusy} onClick={onExportReport}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Report
            </button>
            <button type="button" className="s5-ps-close-btn" onClick={guardedClose} disabled={!!pdfBusy} title={pdfBusy ? 'Please wait — the PDF is still opening' : undefined}>Close</button>
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
/* Count chip on each segmented tab — number of live quotations / PIs. */
.s5-seg-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; margin-left: 2px;
  border-radius: 9px; background: rgba(124,58,237,.14); color: #7c3aed;
  font-size: 10.5px; font-weight: 800; line-height: 1;
}
.s5-seg-btn.active .s5-seg-count { background: rgba(255,255,255,.28); color: #fff; }

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
/* Plain neutral-grey scrollbar (not the themed violet one) — matches Stage 3/4. */
.s5-tbl-wrap::-webkit-scrollbar { width: 9px; height: 9px; }
.s5-tbl-wrap::-webkit-scrollbar-track { background: transparent; }
.s5-tbl-wrap::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.s5-tbl-wrap::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
[data-bs-theme="dark"] .s5-tbl-wrap::-webkit-scrollbar-track { background: transparent; }
[data-bs-theme="dark"] .s5-tbl-wrap::-webkit-scrollbar-thumb { background: rgba(148,163,184,.45); }
[data-bs-theme="dark"] .s5-tbl-wrap::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.65); }
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
.s5-nowrap { white-space: nowrap; }
.s5-dash { color: #cbd5e1; font-weight: 700; }

.s5-sr2 {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe); color: #6d28d9;
  font-size: 10px; font-weight: 800; border: 1.5px solid #c4b5fd;
}
/* Read-only document code. No pointer cursor / hover underline — it is a
   label, not a link; editing lives on the row's pencil action. */
.s5-qno {
  color: #7c3aed; font-weight: 800; font-family: ui-monospace, monospace; font-size: 11.5px; letter-spacing: .02em;
  /* Keep the PI / Quotation code on ONE line (e.g. "PI/2026-27/2") instead of
     wrapping into the narrow column. */
  white-space: nowrap;
}
.s5-cf { background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 1px solid #c4b5fd; border-radius: 6px; padding: 2px 9px; font-size: 10.5px; font-weight: 800; color: #6d28d9; font-family: ui-monospace, monospace; }
.s5-dt2 { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: #dbeafe; color: #1d4ed8; border: 1px solid #bfdbfe; }
.s5-cur2 { display: inline-flex; padding: 3px 10px; border-radius: 6px; font-size: 10.5px; font-weight: 800; background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
.s5-val2 { font-weight: 800; color: #059669; font-size: 12px; font-family: ui-monospace, monospace; }
.s5-st-live { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; white-space: nowrap; }
.s5-st-dot { width: 5px; height: 5px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 4px rgba(34,197,94,.8); }
/* Status badge — clean solid pill matching the Document Type badge (s5-dt2),
   colour-coded by signature state (no live dot). */
.s5-st-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; white-space: nowrap; }
.s5-st-signed  { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.s5-st-sent    { background: #fef9c3; color: #854d0e; border: 1px solid #fde68a; }
.s5-st-notsent { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
.s5-st-declined { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
.s5-st-recalled { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }

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
/* Tiny white spinner for the "Checking…" signing-status loader pill (that pill
   has a purple background, so white reads fine there). */
.s5-sig-spin {
  display: inline-block; width: 11px; height: 11px;
  border: 2px solid rgba(255,255,255,.45); border-top-color: #fff;
  border-radius: 50%; animation: s5-sig-spin-rot .6s linear infinite;
}
/* Spinner for the ICON buttons (view / etc.). Inherits the button's own colour
   via currentColor — the white .s5-sig-spin was invisible here in light mode,
   where the icon button has a white background (QA: "view loader missing"). */
.s5-icn-spin {
  display: inline-block; width: 13px; height: 13px; box-sizing: border-box;
  border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: s5-sig-spin-rot .6s linear infinite;
}
@keyframes s5-sig-spin-rot { to { transform: rotate(360deg); } }
.s5-converted-chip { display: inline-flex; align-items: center; padding: 4px 11px; border-radius: 20px; font-size: 9.5px; font-weight: 800; background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; white-space: nowrap; }
/* All action icon buttons (view, reminder, email, edit, more, delete) share
   ONE neutral resting style so the row reads as a tidy, uniform toolbar. Each
   variant only contributes its accent colour on hover. */
.s5-icn {
  width: 28px; height: 28px; border-radius: 7px; cursor: pointer; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #e2e8f0; background: #f8fafc; color: #64748b;
  transition: all .15s;
}
.s5-icn:disabled { opacity: .5; cursor: not-allowed; }
/* Full-viewport lock shown while a document is opening — blocks every click on
   the page (step pills, action buttons, side panels) until the fetch resolves. */
.s5-pagelock { position: fixed; inset: 0; z-index: 13000; background: rgba(30, 18, 60, .18); backdrop-filter: none; cursor: wait; display: flex; align-items: center; justify-content: center; animation: s5PagelockIn .12s ease; }
@keyframes s5PagelockIn { from { opacity: 0; } to { opacity: 1; } }
.s5-pagelock-card { display: inline-flex; align-items: center; gap: 12px; padding: 14px 22px; border-radius: 14px; background: #fff; box-shadow: 0 18px 44px rgba(30, 18, 60, .28); font-size: 13px; font-weight: 700; color: #4c1d95; }
.s5-pagelock-spin { width: 18px; height: 18px; border-radius: 50%; border: 2.6px solid #ede9fe; border-top-color: #7c3aed; animation: s5PagelockSpin .7s linear infinite; }
@keyframes s5PagelockSpin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .s5-pagelock-card { background: #1c1738; color: #ede9fe; box-shadow: 0 18px 44px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .s5-pagelock-spin { border-color: #2b2450; border-top-color: #a78bfa; }
/* Lock the tab switcher + summary button while a row action (PDF view /
   download / email) is in flight, so context can't change mid-load. */
.s5-seg-btn:disabled, .s5-summary-btn:disabled { opacity: .55; cursor: not-allowed; pointer-events: none; }
/* Default neutral hover — applies to the plain buttons (view / reminder) and
   any variant that doesn't define its own accent. */
.s5-icn:hover:not(:disabled):not(.s5-icn-cooling) { background: #475569; color: #fff; border-color: transparent; transform: translateY(-1px); }
/* Rate-limit cooldown — dimmed disabled LOOK but still clickable so the
   click surfaces the "please wait" toast. No hover lift while cooling. */
.s5-icn-cooling { opacity: .45; cursor: not-allowed; }
.s5-icn-cooling:hover { transform: none !important; }
.s5-icn-mail:hover:not(:disabled):not(.s5-icn-cooling) { background: #3b82f6; color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-icn-edit:hover:not(:disabled) { background: #16a34a; color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-icn-more:hover:not(:disabled) { background: #475569; color: #fff; border-color: transparent; }

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
.s5-menu-sec-ct { color: #15803d; }
.s5-menu-item {
  display: flex; align-items: center; gap: 9px; width: calc(100% - 10px); margin: 1px 5px;
  padding: 7px 13px; border: none; background: none; cursor: pointer; border-radius: 7px;
  font-family: inherit; font-size: 10.5px; font-weight: 600; color: #0f172a; text-align: left; transition: all .13s;
}
.s5-mi-ico { width: 24px; height: 24px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.s5-mi-dl .s5-mi-ico { background: rgba(109,40,217,.1); color: #6d28d9; }
.s5-mi-vw .s5-mi-ico { background: rgba(124,58,237,.1); color: #7c3aed; }
.s5-mi-ct .s5-mi-ico { background: rgba(21,128,61,.1); color: #15803d; }
.s5-mi-dl:hover { background: rgba(109,40,217,.1); color: #6d28d9; padding-left: 16px; }
.s5-mi-vw:hover { background: rgba(124,58,237,.1); color: #7c3aed; padding-left: 16px; }
.s5-mi-ct:hover { background: rgba(21,128,61,.1); color: #15803d; padding-left: 16px; }
.s5-menu-div { height: 1px; background: linear-gradient(90deg, rgba(124,58,237,.15), rgba(124,58,237,.05), transparent); margin: 5px 8px; }
/* In-menu action spinner — inherits the item's icon colour (currentColor). */
.s5-menu-spin {
  width: 13px; height: 13px; display: inline-block; box-sizing: border-box;
  border: 2px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: s5-sig-spin-rot .6s linear infinite;
}
/* While one action is loading: dim the idle items, keep the busy row bright,
   and freeze the hover padding-shift so nothing jumps. */
.s5-menu.is-busy .s5-menu-item { opacity: .45; }
.s5-menu.is-busy .s5-menu-item:has(.s5-menu-spin) { opacity: 1; }
.s5-menu-item:disabled { cursor: progress; }
.s5-menu-item:disabled:hover { padding-left: 13px; background: none; }

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
.s5-ps-stat-neu { background: rgba(100,116,139,.06); }
.s5-ps-stat-lbl { font-size: 7.5px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 3px; }
.s5-ps-stat-val { font-size: 12px; font-weight: 900; font-family: ui-monospace, monospace; letter-spacing: .01em; }
.s5-ps-stat-val.c-cyan { color: #0891b2; }
.s5-ps-stat-val.c-blue { color: #0369a1; }
.s5-ps-stat-val.c-green { color: #059669; }
.s5-ps-stat-val.c-red { color: #dc2626; }
.s5-ps-stat-val.c-neutral { color: #475569; }

/* Table */
.s5-ps-tablewrap { flex: 1; overflow-y: auto; max-height: 300px; }
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
.s5-ps-quoted.c-neutral { color: #475569; }
.s5-ps-diff { display: inline-flex; align-items: center; gap: 2px; padding: 1px 6px; border-radius: 4px; font-size: 8.5px; font-weight: 800; margin-top: 2px; }
/* Quoted ABOVE target (▲ over) is unfavorable → red;
   quoted BELOW target (▼ under) is favorable → green. */
.s5-ps-diff.over { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
.s5-ps-diff.under { background: #dcfce7; color: #16a34a; border: 1px solid #86efac; }
.s5-ps-acts { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.s5-ps-act { width: 30px; height: 30px; border-radius: 8px; border: 1.5px solid #bae6fd; background: #f0f9ff; color: #0891b2; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all .15s; }
.s5-ps-act:hover:not(:disabled) { background: #0891b2; color: #fff; border-color: transparent; transform: translateY(-1px); }
.s5-ps-act-dl:hover:not(:disabled) { background: #0c4a6e; }
.s5-ps-act:disabled { opacity: .5; cursor: not-allowed; }
/* The row action that's actually loading keeps full opacity + shows a spinner. */
.s5-ps-act:disabled:has(.s5-ps-spin) { opacity: 1; cursor: progress; }
.s5-ps-spin { width: 13px; height: 13px; box-sizing: border-box; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: s5-sig-spin-rot .6s linear infinite; }

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
[data-bs-theme="dark"] .s5-tbl tbody tr:nth-child(even),
[data-layout-mode="dark"] .s5-tbl tbody tr:nth-child(even) { background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .s5-tbl tbody tr:hover,
[data-layout-mode="dark"] .s5-tbl tbody tr:hover { background: rgba(124,58,237,.20); }
/* Row being converted/acted on — the light #ede9fe !important base showed
   as a near-white strip in dark mode behind the Convert modal. Override it
   (also !important to beat the light rule) for both dark attributes. */
[data-bs-theme="dark"] .s5-row-acting,
[data-layout-mode="dark"] .s5-row-acting { background: rgba(124,58,237,.28) !important; }
[data-bs-theme="dark"] .s5-muted { color: #94a3b8; }
[data-bs-theme="dark"] .s5-cur2 { background: rgba(148,163,184,.18); color: #cbd5e1; border-color: rgba(148,163,184,.30); }
[data-bs-theme="dark"] .s5-dt2 { background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.35); }
[data-bs-theme="dark"] .s5-cf { background: rgba(56,189,248,.15); color: #7dd3fc; border-color: rgba(56,189,248,.35); }
[data-bs-theme="dark"] .s5-st-live { background: rgba(34,197,94,.18); color: #86efac; border-color: rgba(34,197,94,.35); }
/* Status badge (clean pill) — dark, colour-coded by state. */
[data-bs-theme="dark"] .s5-st-signed,  [data-layout-mode="dark"] .s5-st-signed  { background: rgba(34,197,94,.18);  color: #86efac; border-color: rgba(34,197,94,.35); }
[data-bs-theme="dark"] .s5-st-sent,    [data-layout-mode="dark"] .s5-st-sent    { background: rgba(234,179,8,.18);   color: #fde047; border-color: rgba(234,179,8,.35); }
[data-bs-theme="dark"] .s5-st-notsent, [data-layout-mode="dark"] .s5-st-notsent { background: rgba(148,163,184,.16); color: #cbd5e1; border-color: rgba(148,163,184,.30); }
[data-bs-theme="dark"] .s5-st-declined, [data-layout-mode="dark"] .s5-st-declined { background: rgba(239,68,68,.18); color: #fca5a5; border-color: rgba(239,68,68,.35); }
[data-bs-theme="dark"] .s5-st-recalled, [data-layout-mode="dark"] .s5-st-recalled { background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(245,158,11,.35); }
/* Uniform action icons — dark neutral resting surface (hover accents already
   work on dark). */
[data-bs-theme="dark"] .s5-icn, [data-layout-mode="dark"] .s5-icn { background: rgba(148,163,184,.12); border-color: rgba(148,163,184,.28); color: #cbd5e1; }
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

/* ─── Latest Quoted Price Summary popup — dark mode ───
   Header + table head are already dark gradients; darken the body, stats
   bar, table cells, chips and footer so the whole popup reads dark. Both
   theme attributes covered. */
[data-bs-theme="dark"] .s5-ps-modal,
[data-layout-mode="dark"] .s5-ps-modal { background: #0f172a; }
/* Stats bar */
[data-bs-theme="dark"] .s5-ps-stats,
[data-layout-mode="dark"] .s5-ps-stats { background: linear-gradient(90deg, #111c2e, #0e1a26, #111c2e); border-bottom-color: rgba(56,189,248,.22); }
[data-bs-theme="dark"] .s5-ps-stat,
[data-layout-mode="dark"] .s5-ps-stat { border-right-color: rgba(56,189,248,.16); }
[data-bs-theme="dark"] .s5-ps-stat-tint,
[data-layout-mode="dark"] .s5-ps-stat-tint { background: rgba(8,145,178,.12); }
[data-bs-theme="dark"] .s5-ps-stat-red,
[data-layout-mode="dark"] .s5-ps-stat-red { background: rgba(239,68,68,.12); }
[data-bs-theme="dark"] .s5-ps-stat-grn,
[data-layout-mode="dark"] .s5-ps-stat-grn { background: rgba(5,150,105,.12); }
[data-bs-theme="dark"] .s5-ps-stat-lbl,
[data-layout-mode="dark"] .s5-ps-stat-lbl { color: #94a3b8; }
[data-bs-theme="dark"] .s5-ps-stat-val.c-cyan,
[data-layout-mode="dark"] .s5-ps-stat-val.c-cyan { color: #22d3ee; }
[data-bs-theme="dark"] .s5-ps-stat-val.c-blue,
[data-layout-mode="dark"] .s5-ps-stat-val.c-blue { color: #38bdf8; }
[data-bs-theme="dark"] .s5-ps-stat-val.c-green,
[data-layout-mode="dark"] .s5-ps-stat-val.c-green { color: #34d399; }
[data-bs-theme="dark"] .s5-ps-stat-val.c-red,
[data-layout-mode="dark"] .s5-ps-stat-val.c-red { color: #f87171; }
[data-bs-theme="dark"] .s5-ps-stat-val.c-neutral,
[data-layout-mode="dark"] .s5-ps-stat-val.c-neutral { color: #cbd5e1; }
[data-bs-theme="dark"] .s5-ps-quoted.c-neutral,
[data-layout-mode="dark"] .s5-ps-quoted.c-neutral { color: #cbd5e1; }
[data-bs-theme="dark"] .s5-ps-stat-neu,
[data-layout-mode="dark"] .s5-ps-stat-neu { background: rgba(100,116,139,.14); }
/* Table body */
[data-bs-theme="dark"] .s5-ps-table tbody td,
[data-layout-mode="dark"] .s5-ps-table tbody td { color: #e2e8f0; border-bottom-color: rgba(255,255,255,.06); }
[data-bs-theme="dark"] .s5-ps-table tbody tr:nth-child(even),
[data-layout-mode="dark"] .s5-ps-table tbody tr:nth-child(even) { background: rgba(255,255,255,.03); }
[data-bs-theme="dark"] .s5-ps-table tbody tr:hover,
[data-layout-mode="dark"] .s5-ps-table tbody tr:hover { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .s5-ps-empty,
[data-layout-mode="dark"] .s5-ps-empty { color: #94a3b8; }
[data-bs-theme="dark"] .s5-ps-sr,
[data-layout-mode="dark"] .s5-ps-sr { background: linear-gradient(135deg, rgba(56,189,248,.18), rgba(14,165,233,.22)); color: #7dd3fc; border-color: rgba(56,189,248,.35); }
[data-bs-theme="dark"] .s5-ps-code,
[data-layout-mode="dark"] .s5-ps-code { background: rgba(56,189,248,.12); color: #7dd3fc; border-color: rgba(56,189,248,.30); }
[data-bs-theme="dark"] .s5-ps-name,
[data-layout-mode="dark"] .s5-ps-name { color: #f1f5f9; }
[data-bs-theme="dark"] .s5-ps-date,
[data-layout-mode="dark"] .s5-ps-date { color: #cbd5e1; }
[data-bs-theme="dark"] .s5-ps-qty,
[data-layout-mode="dark"] .s5-ps-qty { color: #f1f5f9; }
[data-bs-theme="dark"] .s5-ps-target,
[data-layout-mode="dark"] .s5-ps-target { color: #38bdf8; }
[data-bs-theme="dark"] .s5-ps-act,
[data-layout-mode="dark"] .s5-ps-act { background: rgba(56,189,248,.12); color: #7dd3fc; border-color: rgba(56,189,248,.28); }
[data-bs-theme="dark"] .s5-ps-act:hover:not(:disabled),
[data-layout-mode="dark"] .s5-ps-act:hover:not(:disabled) { background: #0891b2; color: #fff; border-color: transparent; }
/* Footer */
[data-bs-theme="dark"] .s5-ps-foot,
[data-layout-mode="dark"] .s5-ps-foot { background: linear-gradient(90deg, #111c2e, #0e1a26); border-top-color: rgba(56,189,248,.18); }
[data-bs-theme="dark"] .s5-ps-foot-note,
[data-layout-mode="dark"] .s5-ps-foot-note { color: #94a3b8; }
[data-bs-theme="dark"] .s5-ps-export,
[data-layout-mode="dark"] .s5-ps-export { background: rgba(56,189,248,.10); color: #7dd3fc; border-color: rgba(56,189,248,.30); box-shadow: none; }
[data-bs-theme="dark"] .s5-ps-export:hover:not(:disabled),
[data-layout-mode="dark"] .s5-ps-export:hover:not(:disabled) { background: linear-gradient(135deg, #0891b2, #0e7490); color: #fff; border-color: transparent; }

@media (max-width: 820px) {
  .s5-tab-row { flex-direction: column; align-items: stretch; }
  .s5-head-right { flex-wrap: wrap; }
}
`;
