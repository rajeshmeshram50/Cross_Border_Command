import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import Tooltip from '../../../components/ui/Tooltip';
import SalesCustomerSendForSignatureModal, {
  type AgreementSendRow,
  type AgreementSigner,
} from '../SalesCustomerSendForSignatureModal';
import { type HeaderConfig, type FooterConfig } from '../../hrms/doc-templates/HeaderFooterPanel';

/*
 * Sales Matrix → Lead detail → "Segment Details" card → Highly / Less
 * Regulated Segments popup.
 *
 * Walks the lead's latest non-cancelled PI products → distinct product
 * segments → applicable agreements per segment, filtered to the chosen
 * regulatory tier. Each agreement row carries Send + Preview actions.
 *
 * Send target: POST /api/clm/signature-requests/agreement-send (auto-
 * resolves signers from the agreement's `party` CSV against the lead's
 * customer + consignee — one Zoho request per agreement, multi-party
 * agreements get parallel signers on the same PDF).
 *
 * Preview target: POST /api/clm/signature-requests/agreement-preview
 * (returns the merged PDF as a blob; opened in a new tab via
 * URL.createObjectURL).
 */

export type AgreementRowSig = {
  id: number;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  signed_url: string | null;
  certificate_url: string | null;
} | null;

export type AgreementRow = {
  id: number;
  code: string | null;
  title: string;
  agreement_type: string;
  party: string;
  regulatory: 'highly' | 'less';
  segment: string | null;
  required: 'REQ' | 'OPT';
  updated_at: string | null;
  signature_request: AgreementRowSig;
  /* Send-for-Signature editor seed fields — body HTML + saved page-
   * shell config so the Edit Header/Footer/Body popup in the
   * workplace can hydrate without an extra fetch. Backend supplies
   * these from applicableForLead. */
  content?: string | null;
  header_config?: HeaderConfig | null;
  footer_config?: FooterConfig | null;
};

export type ApplicableSegment = {
  id: number;
  code: string;
  name: string;
  regulatory: 'highly' | 'less';
  agreements: AgreementRow[];
};

export type ApplicablePayload = {
  stage5Complete: boolean;
  lead: {
    id: number;
    code: string | null;
    customer: { id: number; name: string; email: string | null } | null;
    consignee: { id: number; name: string; email: string | null } | null;
  };
  pi: { id: number; code: string | null; status: string | null } | null;
  totals: {
    highly: { matched: number; total: number };
    less:   { matched: number; total: number };
  };
  segments: ApplicableSegment[];
};

interface Props {
  open: boolean;
  leadId: number | null | undefined;
  tier: 'highly' | 'less';
  onClose: () => void;
  /** Optional payload override — when the parent already fetched the
   *  applicable data it can pass it through to skip a duplicate fetch. */
  data?: ApplicablePayload | null;
  /** Called after a successful Send so the parent (SalesMatrixDetail)
   *  can refresh its own segment-counts/status snapshot. */
  onSent?: () => void;
}

const TIER_META = {
  highly: { title: 'Highly Regulated Segment Agreements', sub: 'Manage agreements for restricted product categories' },
  less:   { title: 'Less Regulated Segment Agreements',   sub: 'Manage agreements for general product categories'    },
} as const;

export default function LeadAgreementSendModal({ open, leadId, tier, onClose, data, onSent }: Props) {
  const toast = useToast();
  const [payload, setPayload] = useState<ApplicablePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeSegId, setActiveSegId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  /* Bulk selection. Multi-row checkbox state — the "Send Selected"
   * footer button fires a single Zoho request containing every
   * checked agreement. Selection is locked to a single applicable-
   * party CSV across all picked rows; checkboxes on rows whose
   * party differs from the first pick are disabled until the user
   * clears the selection. */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [reminderId, setReminderId]   = useState<number | null>(null);

  /* Normalise the agreement's `party` CSV into a stable key so
   * "Buyer, Consignee" and "buyer,consignee" group together. Matches
   * the server-side normaliser in ClmSignatureController::agreementSend. */
  const partyKey = (party: string | null | undefined) =>
    String(party ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(',');

  // Index every agreement currently visible across all segments so
  // the bulk selection state can look up rows by id when the active
  // tab changes (and so `selectedAgreementRows` resolves to ordered
  // AgreementRow objects for the bulk send).
  const allAgreementsById = useMemo(() => {
    const m = new Map<number, AgreementRow>();
    (payload?.segments ?? []).forEach(seg =>
      seg.agreements.forEach(a => { if (!m.has(a.id)) m.set(a.id, a); }));
    return m;
  }, [payload]);

  const selectedAgreementRows = useMemo(
    () => Array.from(selectedIds).map(id => allAgreementsById.get(id)).filter((a): a is AgreementRow => !!a),
    [selectedIds, allAgreementsById],
  );

  // Locked party for the active bulk selection — taken from the first
  // selected row. While at least one row is selected, every other row
  // whose normalised party doesn't match this key is disabled at the
  // checkbox level (rendered as a greyed-out lock).
  const selectedPartyKey = selectedAgreementRows.length > 0
    ? partyKey(selectedAgreementRows[0].party)
    : null;

  /* Per-row predicate driving the checkbox disabled state. Rows the
   * recipient has already signed (or that are in-progress) shouldn't
   * be re-bundled, and rows whose party differs from the lock are
   * out of bounds until the selection is cleared. */
  const canSelectAgreement = (a: AgreementRow): boolean => {
    const sig = a.signature_request;
    const sigStatus = sig?.status ?? 'draft';
    if (sigStatus !== 'draft' && sigStatus !== 'recalled') return false;
    if (!selectedPartyKey) return true;
    return partyKey(a.party) === selectedPartyKey;
  };

  const toggleSelect = (a: AgreementRow) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(a.id)) {
        next.delete(a.id);
      } else {
        if (!canSelectAgreement(a)) return prev;
        next.add(a.id);
      }
      return next;
    });
  };

  /* Header checkbox driver. "Select all in this tab" toggles every
   * sendable row inside the active segment. If they're all already
   * selected, the click clears them; otherwise it adds the missing
   * ones (and seeds selectedPartyKey from the first if empty). */
  const toggleSelectAll = (seg: ApplicableSegment | null) => {
    if (!seg) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      const eligible = seg.agreements.filter(a => {
        const sig = a.signature_request;
        const status = sig?.status ?? 'draft';
        return status === 'draft' || status === 'recalled';
      });
      if (eligible.length === 0) return prev;
      // Use the FIRST eligible row's party as the lock if nothing's
      // selected yet, otherwise honour the existing lock.
      const seedKey = prev.size > 0 ? selectedPartyKey : partyKey(eligible[0].party);
      const matching = eligible.filter(a => partyKey(a.party) === seedKey);
      const allChecked = matching.every(a => next.has(a.id));
      if (allChecked) {
        matching.forEach(a => next.delete(a.id));
      } else {
        matching.forEach(a => next.add(a.id));
      }
      return next;
    });
  };

  // Header-checkbox state for the active tab — checked when every
  // matching-party row is already in the selection, indeterminate
  // when only some are, disabled when there's nothing sendable.
  const headerCheckEligible = (activeSegId
    ? (payload?.segments.find(s => s.id === activeSegId)?.agreements ?? [])
    : []).filter(a => {
      const status = a.signature_request?.status ?? 'draft';
      return (status === 'draft' || status === 'recalled')
        && (!selectedPartyKey || partyKey(a.party) === selectedPartyKey);
    });
  const headerCheckSelectedCount = headerCheckEligible.filter(a => selectedIds.has(a.id)).length;
  const headerCheckChecked       = headerCheckEligible.length > 0 && headerCheckSelectedCount === headerCheckEligible.length;
  const headerCheckIndeterminate = headerCheckSelectedCount > 0 && !headerCheckChecked;
  const headerCheckDisabled      = headerCheckEligible.length === 0;

  /* Send-for-Signature modal launch state. The actual preview +
   * draggable signature box UI lives in SalesCustomerSendForSignatureModal
   * (mode="agreement") so the workplace flow looks and feels identical
   * to the customer/consignee trade-doc tab's Send step. We just track
   * which agreements were picked when the user clicked Send. */
  const [ssfAgreements, setSsfAgreements] = useState<AgreementRow[]>([]);

  /* Escape-to-close mirrors the rest of the matrix modals. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Fetch the applicable agreements when the modal opens for a new
   * lead/tier — unless the parent already supplied the payload. */
  useEffect(() => {
    if (!open || !leadId) { setPayload(null); setActiveSegId(null); return; }
    if (data) { setPayload(data); return; }
    let cancelled = false;
    setLoading(true);
    api.get(`/clm/leads/${leadId}/agreement-applicable`)
      .then(r => { if (!cancelled) setPayload((r.data?.data ?? null) as ApplicablePayload | null); })
      .catch(() => { if (!cancelled) setPayload(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, leadId, data]);

  // Tier-filtered segments — these are the tab list.
  const tierSegments = useMemo(
    () => (payload?.segments ?? []).filter(s => s.regulatory === tier),
    [payload, tier],
  );

  // Default the active tab to the first segment whenever the segment
  // list changes (e.g. fresh fetch or tier flip).
  useEffect(() => {
    if (!tierSegments.length) { setActiveSegId(null); return; }
    if (!activeSegId || !tierSegments.find(s => s.id === activeSegId)) {
      setActiveSegId(tierSegments[0].id);
    }
  }, [tierSegments, activeSegId]);

  const activeSeg = tierSegments.find(s => s.id === activeSegId) ?? null;

  /* Open the agreement PDF preview in a new tab. The backend response
   * is a binary stream, so we wrap it in a Blob and createObjectURL it.
   * Using window.open(_blank) lets the user keep this modal up while
   * they review the preview. */
  const handlePreview = async (agreementId: number) => {
    if (!leadId) return;
    setPreviewingId(agreementId);
    try {
      const resp = await api.post(
        '/clm/signature-requests/agreement-preview',
        { agreement_id: agreementId, lead_id: leadId },
        { responseType: 'blob' },
      );
      const blob = new Blob([resp.data], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const w = window.open(url, '_blank', 'noopener,noreferrer');
      if (!w) toast.error('Popup blocked', 'Allow popups to view the preview.');
      // Revoke the blob URL after the tab has had time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not render the preview.';
      toast.error('Preview failed', msg);
    } finally {
      setPreviewingId(null);
    }
  };

  /* Send — hands off to SalesCustomerSendForSignatureModal in
   * agreement mode. That modal handles the preview blob fetch + the
   * draggable signature box + the eventual POST to /agreement-send,
   * so this side just supplies the picked agreements and waits for
   * its `onSent` callback to refresh our row statuses. */
  const handleSend = (agreements: AgreementRow[]) => {
    if (!leadId || agreements.length === 0) return;
    setSsfAgreements(agreements);
  };

  /* Refresh the applicable payload after a successful Send so the
   * row status pills flip to "In Progress" and the parent
   * (SalesMatrixDetail) can refresh its segment-counts snapshot. */
  const onSsfSent = async () => {
    setSsfAgreements([]);
    setSelectedIds(new Set());
    if (leadId) {
      try {
        const ref = await api.get(`/clm/leads/${leadId}/agreement-applicable`);
        setPayload((ref.data?.data ?? null) as ApplicablePayload | null);
      } catch {
        // ignore — UI still works on the previous payload
      }
    }
    onSent?.();
  };

  /* Resend a Zoho reminder for an existing in-progress signature
   * request. Hits the same /clm/signature-requests/{id}/remind
   * endpoint the customer/consignee/vendor flows use — no doc-type
   * specific logic on the backend, so the wiring is one-line. */
  const handleRemind = async (signatureRequestId: number) => {
    setReminderId(signatureRequestId);
    try {
      const { data: r } = await api.post(`/clm/signature-requests/${signatureRequestId}/remind`);
      toast.success('Reminder sent', r?.message ?? 'Reminder dispatched to the recipient.');
      if (leadId) {
        try {
          const ref = await api.get(`/clm/leads/${leadId}/agreement-applicable`);
          setPayload((ref.data?.data ?? null) as ApplicablePayload | null);
        } catch { /* swallow */ }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not send the reminder.';
      toast.error('Reminder failed', msg);
    } finally {
      setReminderId(null);
    }
  };

  if (!open) return null;

  const meta = TIER_META[tier];

  return createPortal(
    <div className="lasm-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{LASM_CSS}</style>
      <div className="lasm-shell" onMouseDown={(e) => e.stopPropagation()}>
        {/* ── HEADER ── */}
        <div className="lasm-head">
          <div className="lasm-head-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div className="lasm-head-text">
            <div className="lasm-head-title">{meta.title}</div>
            <div className="lasm-head-sub">{meta.sub}</div>
          </div>
          <button type="button" className="lasm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── BODY ── */}
        <div className="lasm-body">
          {loading ? (
            <div className="lasm-empty">Loading agreements…</div>
          ) : !payload ? (
            <div className="lasm-empty">Could not load applicable agreements.</div>
          ) : !payload.pi ? (
            <div className="lasm-empty lasm-empty-warn">
              Map a Proforma Invoice to this lead first — agreement send unlocks once a PI is attached.
            </div>
          ) : tierSegments.length === 0 ? (
            <div className="lasm-empty">
              No {tier === 'highly' ? 'highly' : 'less'}-regulated segments in this lead's PI yet.
            </div>
          ) : (
            <>
              {/* Tabs — one per applicable segment */}
              <div className="lasm-tabs">
                {tierSegments.map(seg => (
                  <button
                    key={seg.id}
                    type="button"
                    role="tab"
                    aria-selected={seg.id === activeSegId}
                    className={`lasm-tab ${seg.id === activeSegId ? 'is-on' : ''}`}
                    onClick={() => setActiveSegId(seg.id)}
                  >
                    {seg.name}
                  </button>
                ))}
              </div>

              {/* Table for the active segment */}
              <div className="lasm-table-wrap">
                <table className="lasm-table">
                  <thead>
                    <tr>
                      <th style={{ width: 38 }}>
                        {/* Checkbox header — selects every row in the
                            active segment whose applicable_party still
                            satisfies the bulk same-party lock. Disabled
                            if there are no sendable rows in view. */}
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          ref={el => { if (el) el.indeterminate = headerCheckIndeterminate; }}
                          checked={headerCheckChecked}
                          disabled={headerCheckDisabled}
                          onChange={() => toggleSelectAll(activeSeg)}
                        />
                      </th>
                      <th style={{ width: 56 }}>Sr No.</th>
                      <th>Document</th>
                      <th style={{ width: 110 }}>Required</th>
                      <th style={{ width: 130 }}>Updated On</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th style={{ width: 210 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!activeSeg || activeSeg.agreements.length === 0) ? (
                      <tr><td colSpan={7} className="lasm-empty-row">No agreements configured for this segment yet.</td></tr>
                    ) : activeSeg.agreements.map((a, idx) => {
                      const sig = a.signature_request;
                      const sigStatus = sig?.status ?? 'draft';
                      const sentAlready = sigStatus !== 'draft' && sigStatus !== 'recalled';
                      const isPrev        = previewingId === a.id;
                      const isRemind      = !!sig && reminderId === sig.id;
                      const checkboxLocked = sentAlready || !canSelectAgreement(a);
                      const checked       = selectedIds.has(a.id);
                      const showReminder  = sig && (sigStatus === 'inprogress');
                      return (
                        <tr key={a.id} className={checked ? 'lasm-row-selected' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.title}`}
                              checked={checked}
                              disabled={checkboxLocked}
                              title={
                                sentAlready
                                  ? `Already ${sigStatus} — bulk send only covers unsent agreements`
                                  : (canSelectAgreement(a)
                                      ? 'Add to bulk selection'
                                      : `Locked — bulk selection is tied to "${selectedPartyKey ?? ''}" applicable party`)
                              }
                              onChange={() => toggleSelect(a)}
                            />
                          </td>
                          <td>{idx + 1}</td>
                          <td>
                            <div className="lasm-doc-name">{a.title}</div>
                            <div className="lasm-doc-sub">{a.agreement_type || '—'} · {a.party}</div>
                          </td>
                          <td>
                            <span className={`lasm-pill ${a.required === 'REQ' ? 'lasm-pill-req' : 'lasm-pill-opt'}`}>{a.required}</span>
                          </td>
                          <td className="lasm-mono">{a.updated_at ?? '—'}</td>
                          <td>
                            <StatusPill status={sigStatus} />
                          </td>
                          <td>
                            <div className="lasm-actions">
                              {!sentAlready && (
                                <Tooltip label="Send for signature">
                                  <button
                                    type="button"
                                    className="lasm-btn-send"
                                    onClick={() => handleSend([a])}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                    Send
                                  </button>
                                </Tooltip>
                              )}
                              {showReminder && (
                                <Tooltip label="Resend reminder to the signer(s)">
                                  <button
                                    type="button"
                                    className="lasm-btn-remind"
                                    disabled={isRemind}
                                    onClick={() => void handleRemind(sig!.id)}
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                                    {isRemind ? 'Sending…' : 'Remind'}
                                  </button>
                                </Tooltip>
                              )}
                              <Tooltip label="Preview agreement PDF">
                                <button
                                  type="button"
                                  className="lasm-btn-eye"
                                  disabled={isPrev}
                                  onClick={() => void handlePreview(a.id)}
                                  aria-label="Preview"
                                >
                                  {isPrev ? (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                  ) : (
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                  )}
                                </button>
                              </Tooltip>
                              {sig?.signed_url && (
                                <Tooltip label="View / download signed PDF">
                                  <a href={sig.signed_url} target="_blank" rel="noreferrer" className="lasm-btn-icon" aria-label="Signed PDF" download>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                  </a>
                                </Tooltip>
                              )}
                              {sig?.certificate_url && (
                                <Tooltip label="Certificate of Completion">
                                  <a href={sig.certificate_url} target="_blank" rel="noreferrer" className="lasm-btn-cert" aria-label="Certificate" download>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
                                  </a>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bulk send sticky footer — only visible when ≥1 row is
                  checked. The button caption surfaces the applicable
                  party so it's obvious which signer set is locked in
                  for this bundle. */}
              {selectedIds.size > 0 && (
                <div className="lasm-bulk-bar">
                  <div className="lasm-bulk-info">
                    <strong>{selectedIds.size}</strong> selected · party-locked to <em>{selectedPartyKey ?? '—'}</em>
                    <button type="button" className="lasm-bulk-clear" onClick={() => setSelectedIds(new Set())}>Clear</button>
                  </div>
                  <button
                    type="button"
                    className="lasm-bulk-send"
                    onClick={() => handleSend(selectedAgreementRows)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    {`Send Selected (${selectedIds.size})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Send-for-Signature modal — reuses the customer/consignee
          trade-doc preview UI (mode="agreement") so the workplace
          flow shows the SAME preview pane the user sees on the
          trade-doc tab. Backend wiring branches to the agreement
          preview/send endpoints inside the modal. */}
      <SalesCustomerSendForSignatureModal
        open={ssfAgreements.length > 0}
        customer={null}
        mode="agreement"
        agreementContext={ssfAgreements.length > 0 && leadId ? (() => {
          /* All agreements in a bulk-send share the same applicable
           * party (the same-party guard is enforced both client- and
           * server-side), so we read the CSV from the first agreement
           * and intersect it with the lead's mapped customer/
           * consignee to build the active signer list. The recipient
           * card and the per-signer draggable signature boxes both
           * iterate this array, so an agreement scoped to "Buyer"
           * only never surfaces the consignee, and a
           * "Buyer, Consignee" agreement gets two independent boxes.
           *
           * Unmapped parties (e.g. agreement expects Consignee but
           * the lead has no consignee_id) are still emitted into the
           * signers array but with email=null, so the modal renders
           * a disabled box + warning row for them. Without this the
           * modal silently dropped the unmapped party and the user
           * couldn't tell why their multi-signer agreement only
           * showed one signature box. */
          const partyTokens = String(ssfAgreements[0].party ?? '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
          const wantsBuyer     = partyTokens.includes('buyer');
          const wantsConsignee = partyTokens.includes('consignee');
          const signers: AgreementSigner[] = [];
          if (wantsBuyer) {
            signers.push({
              role: 'buyer',
              name:  payload?.lead.customer?.name  ?? '⚠ Customer not mapped',
              email: payload?.lead.customer?.email ?? null,
            });
          }
          if (wantsConsignee) {
            signers.push({
              role: 'consignee',
              name:  payload?.lead.consignee?.name  ?? '⚠ Consignee not mapped',
              email: payload?.lead.consignee?.email ?? null,
            });
          }
          // Diagnostic — visible in DevTools so the operator can see
          // exactly which signers got built when the modal opens.
          // eslint-disable-next-line no-console
          console.debug('[agreement-send] resolved signers', {
            leadId,
            partyCsv: ssfAgreements[0].party,
            wantsBuyer,
            wantsConsignee,
            customer:  payload?.lead.customer  ?? null,
            consignee: payload?.lead.consignee ?? null,
            signers,
          });
          return {
            leadId,
            agreements: ssfAgreements.map<AgreementSendRow>(a => ({
              id:             a.id,
              code:           a.code,
              title:          a.title,
              agreement_type: a.agreement_type,
              party:          a.party,
              content:        a.content       ?? null,
              header_config:  a.header_config ?? null,
              footer_config:  a.footer_config ?? null,
            })),
            signers,
          };
        })() : null}
        onClose={() => setSsfAgreements([])}
        onSent={() => { void onSsfSent(); }}
      />
    </div>,
    document.body,
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone =
      s === 'completed'  ? { bg: '#d1fae5', fg: '#047857', mark: '✓', label: 'Signed' }
    : s === 'inprogress' ? { bg: '#dbeafe', fg: '#1e40af', mark: '◔', label: 'In Progress' }
    : s === 'declined'   ? { bg: '#fee2e2', fg: '#b91c1c', mark: '✕', label: 'Declined' }
    : s === 'recalled'   ? { bg: '#fef3c7', fg: '#92400e', mark: '⤺', label: 'Recalled' }
    : s === 'expired'    ? { bg: '#f3e8ff', fg: '#6b21a8', mark: '⌛', label: 'Expired' }
    :                      { bg: '#e2e8f0', fg: '#475569', mark: '●', label: 'Draft' };
  return (
    <span className="lasm-status-pill" style={{ background: tone.bg, color: tone.fg }}>
      {tone.mark} {tone.label}
    </span>
  );
}

/* ── Scoped CSS ────────────────────────────────────────────────────── */
const LASM_CSS = `
.lasm-overlay { position: fixed; inset: 0; z-index: 11500;
  background: rgba(15,23,42,.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif; animation: lasmFade .18s ease both; }
@keyframes lasmFade { from { opacity: 0 } to { opacity: 1 } }
.lasm-shell { width: 100%; max-width: 1080px; max-height: calc(100vh - 48px); display: flex; flex-direction: column;
  border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px rgba(15,23,42,.40); }
.lasm-head { display: flex; align-items: center; gap: 12px;
  padding: 16px 22px; color: #fff;
  background: linear-gradient(110deg,#0c6680 0%,#0e7490 40%,#0891b2 80%,#06b6d4 100%); }
.lasm-head-icon { width: 40px; height: 40px; border-radius: 10px; background: rgba(255,255,255,.18);
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.lasm-head-text { flex: 1; min-width: 0; }
.lasm-head-title { font-size: 17px; font-weight: 800; letter-spacing: -.2px; }
.lasm-head-sub { font-size: 12px; opacity: .85; margin-top: 2px; }
.lasm-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.16); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .15s ease; }
.lasm-close:hover { background: rgba(255,255,255,.28); }
.lasm-body { padding: 0; overflow: auto; flex: 1; min-height: 280px; }
.lasm-empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }
.lasm-empty-warn { color: #92400e; background: linear-gradient(110deg,rgba(251,191,36,.08),rgba(254,243,199,.40)); border-radius: 0; }
.lasm-tabs { display: flex; align-items: stretch; gap: 0; padding: 0 22px;
  border-bottom: 1px solid #e2e8f0; background: #fff; overflow-x: auto; }
.lasm-tab { padding: 14px 18px; background: transparent; border: 0; border-bottom: 3px solid transparent;
  color: #64748b; font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: color .15s ease, border-color .15s ease; }
.lasm-tab:hover { color: #0e7490; }
.lasm-tab.is-on { color: #0e7490; border-bottom-color: #0e7490; }
.lasm-table-wrap { padding: 18px 22px; }
.lasm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.lasm-table thead th { text-align: left; padding: 12px 12px; font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748b; background: linear-gradient(110deg,#fdfaff,#f3f0ff); border-bottom: 1.5px solid rgba(99,102,241,.18); }
.lasm-table tbody td { padding: 12px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; color: #1e293b; }
.lasm-table tbody tr:hover td { background: rgba(241,245,249,.4); }
.lasm-empty-row { text-align: center; color: #94a3b8; padding: 22px !important; }
.lasm-mono { font-family: 'Geist Mono', ui-monospace, monospace; color: #64748b; }
.lasm-doc-name { font-weight: 700; color: #0c4a6e; }
.lasm-doc-sub  { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
.lasm-pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: .06em; }
.lasm-pill-req { background: #fee2e2; color: #b91c1c; }
.lasm-pill-opt { background: #fef3c7; color: #92400e; }
.lasm-status-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.lasm-actions { display: inline-flex; gap: 6px; align-items: center; }
.lasm-btn-send { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px;
  background: linear-gradient(135deg,#06b6d4,#0e7490); color: #fff; border: none; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
.lasm-btn-send:hover:not(.is-disabled):not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(8,145,178,.25); }
.lasm-btn-send.is-disabled, .lasm-btn-send:disabled { opacity: .55; cursor: not-allowed; }
.lasm-btn-eye, .lasm-btn-icon, .lasm-btn-cert { display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; cursor: pointer; text-decoration: none; transition: background .15s ease; }
.lasm-btn-eye { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.lasm-btn-eye:hover:not(:disabled) { background: #e0e7ff; color: #4338ca; }
.lasm-btn-eye:disabled { opacity: .55; cursor: not-allowed; }
.lasm-btn-icon { background: #ecfeff; color: #0e7490; border: 1px solid #67e8f9; }
.lasm-btn-icon:hover { background: #cffafe; }
.lasm-btn-cert { background: #cffafe; color: #0e7490; border: 1px solid #67e8f9; }
.lasm-btn-cert:hover { background: #a5f3fc; }
.lasm-btn-remind { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 7px;
  background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.lasm-btn-remind:hover:not(:disabled) { background: #fde68a; border-color: #f59e0b; }
.lasm-btn-remind:disabled { opacity: .55; cursor: not-allowed; }

.lasm-row-selected td { background: rgba(8,145,178,.06) !important; }

.lasm-bulk-bar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 12px 22px; background: linear-gradient(110deg,#ecfeff,#cffafe);
  border-top: 1.5px solid rgba(8,145,178,.32); box-shadow: 0 -6px 14px rgba(15,23,42,.05); }
.lasm-bulk-info { font-size: 12px; color: #0c4a6e; display: inline-flex; align-items: center; gap: 12px; }
.lasm-bulk-info em { font-style: normal; font-family: 'Geist Mono', ui-monospace, monospace; color: #0e7490; padding: 1px 7px; background: #fff; border-radius: 4px; border: 1px solid #67e8f9; }
.lasm-bulk-clear { background: transparent; border: 1px solid rgba(8,145,178,.32); color: #0e7490;
  font-family: inherit; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer; }
.lasm-bulk-clear:hover { background: #fff; }
.lasm-bulk-send { display: inline-flex; align-items: center; gap: 7px; padding: 9px 18px; border-radius: 9px;
  background: linear-gradient(135deg,#06b6d4,#0e7490); color: #fff; border: none;
  font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
.lasm-bulk-send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(8,145,178,.30); }
.lasm-bulk-send:disabled { opacity: .55; cursor: not-allowed; }

/* Posing pane CSS removed — the agreement Send-for-Signature preview
   now renders inside SalesCustomerSendForSignatureModal, which carries
   its own SSF_CSS for the preview pane, doc rail, sig overlay,
   coord pane and recipient card. */

/* ── Dark mode overrides ──
 * The modal shell, segment-tab strip, document table and bulk-action
 * bar are all hard-coded to light surfaces. Without these the whole
 * modal renders as a near-white card on the dark workplace background. */
[data-bs-theme="dark"] .lasm-shell {
  background: #0f172a;
  box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(6,182,212,.20);
}
[data-bs-theme="dark"] .lasm-empty { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-empty-warn {
  color: #fcd34d;
  background: linear-gradient(110deg, rgba(251,191,36,.08), rgba(217,119,6,.18));
}
[data-bs-theme="dark"] .lasm-tabs {
  background: #0f172a;
  border-bottom-color: rgba(6,182,212,.22);
}
[data-bs-theme="dark"] .lasm-tab { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-tab:hover { color: #67e8f9; }
[data-bs-theme="dark"] .lasm-tab.is-on {
  color: #67e8f9;
  border-bottom-color: #06b6d4;
}
[data-bs-theme="dark"] .lasm-table thead th {
  color: #cffafe;
  background: linear-gradient(110deg, rgba(8,145,178,.20), rgba(99,102,241,.16));
  border-bottom-color: rgba(99,102,241,.35);
}
[data-bs-theme="dark"] .lasm-table tbody td {
  color: #e2e8f0;
  border-bottom-color: rgba(6,182,212,.10);
}
[data-bs-theme="dark"] .lasm-table tbody tr:hover td { background: rgba(8,145,178,.10); }
[data-bs-theme="dark"] .lasm-empty-row { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-mono { color: #94a3b8; }
[data-bs-theme="dark"] .lasm-doc-name { color: #67e8f9; }
[data-bs-theme="dark"] .lasm-doc-sub  { color: #94a3b8; }
/* REQ / OPT pills — bump the tinted backgrounds and brighten the text
 * so they read against the dark row instead of looking like washed-out
 * pastel patches. */
[data-bs-theme="dark"] .lasm-pill-req {
  background: rgba(239,68,68,.20); color: #fca5a5;
}
[data-bs-theme="dark"] .lasm-pill-opt {
  background: rgba(245,158,11,.20); color: #fcd34d;
}
[data-bs-theme="dark"] .lasm-row-selected td { background: rgba(8,145,178,.16) !important; }
[data-bs-theme="dark"] .lasm-btn-eye {
  background: rgba(8,145,178,.10); color: #67e8f9; border-color: rgba(6,182,212,.30);
}
[data-bs-theme="dark"] .lasm-btn-eye:hover:not(:disabled) {
  background: rgba(8,145,178,.22); color: #cffafe;
}
[data-bs-theme="dark"] .lasm-btn-icon {
  background: rgba(8,145,178,.12); color: #67e8f9; border-color: rgba(103,232,249,.35);
}
[data-bs-theme="dark"] .lasm-btn-icon:hover { background: rgba(8,145,178,.24); }
[data-bs-theme="dark"] .lasm-btn-cert {
  background: rgba(8,145,178,.18); color: #cffafe; border-color: rgba(103,232,249,.40);
}
[data-bs-theme="dark"] .lasm-btn-cert:hover { background: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .lasm-btn-remind {
  background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(245,158,11,.40);
}
[data-bs-theme="dark"] .lasm-btn-remind:hover:not(:disabled) {
  background: rgba(245,158,11,.30); border-color: #f59e0b;
}
[data-bs-theme="dark"] .lasm-bulk-bar {
  background: linear-gradient(110deg, rgba(8,145,178,.16), rgba(8,145,178,.10));
  border-top-color: rgba(6,182,212,.35);
  box-shadow: 0 -6px 14px rgba(0,0,0,.30);
}
[data-bs-theme="dark"] .lasm-bulk-info { color: #cffafe; }
[data-bs-theme="dark"] .lasm-bulk-info em {
  color: #67e8f9; background: #0f172a; border-color: rgba(103,232,249,.40);
}
[data-bs-theme="dark"] .lasm-bulk-clear {
  border-color: rgba(103,232,249,.35); color: #67e8f9;
}
[data-bs-theme="dark"] .lasm-bulk-clear:hover { background: rgba(8,145,178,.18); }
`;
