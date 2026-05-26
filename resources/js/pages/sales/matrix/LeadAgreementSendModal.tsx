import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import Tooltip from '../../../components/ui/Tooltip';

/* A4 PDF dimensions in points (1pt = 1/72in). Same constants the trade-
 * doc send flow uses — the draggable signature box reads its coords in
 * the same space so backend handling stays uniform across both flows. */
const A4_W = 595;
const A4_H = 842;

type DocSettings = { x: number; y: number; page: number; width: number; height: number };
/* Default signature box — last-page bottom-right, ~150×45pt. Mirrors
 * the trade-doc send seed so the user's muscle memory carries over. */
const DEFAULT_SIG: DocSettings = { x: 380, y: 720, page: 0, width: 150, height: 45 };

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
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  /* Posing state — when the user clicks Send on a row, we transition
   * into a preview-with-positioning view (same UX as the trade-doc
   * send flow). `posing` carries the agreement being positioned, the
   * PDF blob URL, and the draggable sig-box settings. `posingLoading`
   * gates the UI while the preview blob is being fetched. */
  const [posing, setPosing] = useState<{ agreement: AgreementRow; previewUrl: string; settings: DocSettings } | null>(null);
  const [posingLoading, setPosingLoading] = useState(false);
  const [posingSending, setPosingSending] = useState(false);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapWidthPx, setWrapWidthPx] = useState(0);
  const dragStateRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; initial: DocSettings } | null>(null);

  /* Revoke the preview blob URL when posing tears down so we don't
   * leak object URLs across multiple Send clicks. */
  useEffect(() => {
    return () => { if (posing?.previewUrl) URL.revokeObjectURL(posing.previewUrl); };
  }, [posing?.previewUrl]);

  /* Track the preview wrapper width via ResizeObserver so the overlay
   * draws correctly from the first paint, and stays in sync if the
   * modal is resized. Same pattern as the trade-doc send. */
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el || !posing) return;
    setWrapWidthPx(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setWrapWidthPx(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [posing]);

  const updatePosingSettings = (patch: Partial<DocSettings>) => {
    setPosing(p => (p ? { ...p, settings: { ...p.settings, ...patch } } : p));
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onSigPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!posing) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStateRef.current = { mode, startX: e.clientX, startY: e.clientY, initial: { ...posing.settings } };
    window.addEventListener('pointermove', onSigPointerMove);
    window.addEventListener('pointerup', onSigPointerUp);
  };

  /* These are kept on the component so the listeners can read fresh
   * posing state via the setter — wrapping in useCallback would force
   * us to re-attach on every render. Same trade-off the customer
   * modal made. */
  const onSigPointerMove = (e: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const el = previewWrapRef.current;
    const w  = wrapWidthPx || el?.clientWidth || 0;
    if (w <= 0) return;
    const ptPerPx = A4_W / w;
    const dxPt = (e.clientX - drag.startX) * ptPerPx;
    const dyPt = (e.clientY - drag.startY) * ptPerPx;
    if (drag.mode === 'move') {
      const x = clamp(drag.initial.x + dxPt, 0, A4_W - drag.initial.width);
      const y = clamp(drag.initial.y + dyPt, 0, A4_H - drag.initial.height);
      updatePosingSettings({ x, y });
    } else {
      const width  = clamp(drag.initial.width  + dxPt, 40, A4_W - drag.initial.x);
      const height = clamp(drag.initial.height + dyPt, 24, A4_H - drag.initial.y);
      updatePosingSettings({ width, height });
    }
  };
  const onSigPointerUp = () => {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', onSigPointerMove);
    window.removeEventListener('pointerup', onSigPointerUp);
  };

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

  /* Step 1 of Send — fetch the merged PDF blob and transition into the
   * posing view where the user drags the signature box to its final
   * position. We DON'T POST to /agreement-send here; that happens in
   * confirmSend after the user clicks "Send for Signature" on the
   * posing pane. Matches the trade-doc send flow's preview-then-send
   * UX so users get one consistent muscle memory across CLM modules. */
  const handleSend = async (agreement: AgreementRow) => {
    if (!leadId) return;
    setSendingId(agreement.id);
    setPosingLoading(true);
    try {
      const resp = await api.post(
        '/clm/signature-requests/agreement-preview',
        { agreement_id: agreement.id, lead_id: leadId },
        { responseType: 'blob' },
      );
      const blob = new Blob([resp.data], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      setPosing({ agreement, previewUrl: url, settings: { ...DEFAULT_SIG } });
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not render the preview.';
      toast.error('Preview failed', msg);
    } finally {
      setSendingId(null);
      setPosingLoading(false);
    }
  };

  /* Step 2 of Send — fires the actual Zoho request with the dragged
   * coords. On success the modal returns to the table view, the
   * applicable payload is refreshed so the row's status pill flips
   * to "In Progress", and the parent (SalesMatrixDetail) is notified
   * via onSent so the segment counts can refresh. */
  const confirmSend = async () => {
    if (!posing || !leadId) return;
    setPosingSending(true);
    try {
      const { data: r } = await api.post('/clm/signature-requests/agreement-send', {
        agreement_id: posing.agreement.id,
        lead_id:      leadId,
        document_settings: { [posing.agreement.id]: posing.settings },
      });
      toast.success('Sent', r?.message ?? 'Agreement sent for signature.');
      setPosing(null);
      try {
        const ref = await api.get(`/clm/leads/${leadId}/agreement-applicable`);
        setPayload((ref.data?.data ?? null) as ApplicablePayload | null);
      } catch {
        // ignore — UI still works on the previous payload
      }
      onSent?.();
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? 'Could not send the agreement.';
      toast.error('Send failed', msg);
    } finally {
      setPosingSending(false);
    }
  };

  const cancelPosing = () => {
    if (posing?.previewUrl) URL.revokeObjectURL(posing.previewUrl);
    setPosing(null);
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
          {posing ? (
            <PosingPane
              posing={posing}
              wrapWidthPx={wrapWidthPx}
              previewWrapRef={previewWrapRef}
              onSigPointerDown={onSigPointerDown}
              updateSettings={updatePosingSettings}
              onCancel={cancelPosing}
              onConfirm={() => void confirmSend()}
              sending={posingSending}
              loading={posingLoading}
              recipientName={payload?.lead.customer?.name ?? null}
              recipientEmail={payload?.lead.customer?.email ?? null}
              consigneeName={payload?.lead.consignee?.name ?? null}
              consigneeEmail={payload?.lead.consignee?.email ?? null}
            />
          ) : loading ? (
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
                      <th style={{ width: 56 }}>#</th>
                      <th>Document</th>
                      <th style={{ width: 110 }}>Required</th>
                      <th style={{ width: 130 }}>Updated On</th>
                      <th style={{ width: 130 }}>Status</th>
                      <th style={{ width: 170 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!activeSeg || activeSeg.agreements.length === 0) ? (
                      <tr><td colSpan={6} className="lasm-empty-row">No agreements configured for this segment yet.</td></tr>
                    ) : activeSeg.agreements.map((a, idx) => {
                      const sig = a.signature_request;
                      const sigStatus = sig?.status ?? 'draft';
                      const sentAlready = sigStatus !== 'draft' && sigStatus !== 'recalled';
                      const isSending  = sendingId === a.id;
                      const isPrev     = previewingId === a.id;
                      return (
                        <tr key={a.id}>
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
                              <Tooltip label={sentAlready ? `Already ${sigStatus}` : 'Send for signature'}>
                                <button
                                  type="button"
                                  className={`lasm-btn-send ${sentAlready ? 'is-disabled' : ''}`}
                                  disabled={sentAlready || isSending}
                                  onClick={() => void handleSend(a)}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                                  {isSending ? 'Sending…' : 'Send'}
                                </button>
                              </Tooltip>
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
                                <Tooltip label="Download signed PDF">
                                  <a href={sig.signed_url} target="_blank" rel="noreferrer" className="lasm-btn-icon" aria-label="Signed PDF">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                  </a>
                                </Tooltip>
                              )}
                              {sig?.certificate_url && (
                                <Tooltip label="Certificate of Completion">
                                  <a href={sig.certificate_url} target="_blank" rel="noreferrer" className="lasm-btn-cert" aria-label="Certificate">
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
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Posing pane — shown after Send is clicked on a row ───────────
 *
 * Mirrors the trade-doc Send-for-Signature modal's preview step: the
 * agreement PDF renders in an iframe (Chrome's PDF viewer strips
 * chrome via the fragment params), with a draggable / resizable
 * signature box overlay in the same coord space. Coords are in PDF
 * points (top-left origin, matching Zoho), so the conversion to/from
 * CSS pixels is a uniform scale per wrapWidthPx.
 */
function PosingPane({
  posing,
  wrapWidthPx,
  previewWrapRef,
  onSigPointerDown,
  updateSettings,
  onCancel,
  onConfirm,
  sending,
  loading,
  recipientName,
  recipientEmail,
  consigneeName,
  consigneeEmail,
}: {
  posing: { agreement: AgreementRow; previewUrl: string; settings: DocSettings };
  wrapWidthPx: number;
  previewWrapRef: React.MutableRefObject<HTMLDivElement | null>;
  onSigPointerDown: (e: React.PointerEvent, mode: 'move' | 'resize') => void;
  updateSettings: (patch: Partial<DocSettings>) => void;
  onCancel: () => void;
  onConfirm: () => void;
  sending: boolean;
  loading: boolean;
  recipientName: string | null;
  recipientEmail: string | null;
  consigneeName: string | null;
  consigneeEmail: string | null;
}) {
  const { settings, previewUrl, agreement } = posing;
  const pxPerPt  = wrapWidthPx > 0 ? wrapWidthPx / A4_W : 0;
  const leftPx   = settings.x      * pxPerPt;
  const topPx    = settings.y      * pxPerPt;
  const widthPx  = settings.width  * pxPerPt;
  const heightPx = settings.height * pxPerPt;

  return (
    <div className="lasm-posing">
      <div className="lasm-posing-bar">
        <button type="button" className="lasm-posing-back" onClick={onCancel} disabled={sending}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <div className="lasm-posing-title">
          <div className="lasm-posing-doc">{agreement.title}</div>
          <div className="lasm-posing-sub">{agreement.agreement_type || '—'} · {agreement.party}</div>
        </div>
        <button type="button" className="lasm-posing-send" onClick={onConfirm} disabled={sending || loading || !previewUrl}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {sending ? 'Sending…' : 'Send for Signature'}
        </button>
      </div>

      <div className="lasm-posing-body">
        <div className="lasm-preview-pane">
          {loading ? (
            <div className="lasm-preview-state">Rendering preview…</div>
          ) : !previewUrl ? (
            <div className="lasm-preview-state">Preview unavailable.</div>
          ) : (
            <div className="lasm-preview-wrap" ref={previewWrapRef}>
              {/* #page=N (1-indexed) syncs the visible page to the one
                 the user is positioning on. Re-keying on page forces a
                 reload so the iframe lands on the correct page. */}
              <iframe
                key={`${previewUrl}-p${settings.page}`}
                title="Agreement preview"
                src={`${previewUrl}#page=${(settings.page ?? 0) + 1}&toolbar=0&navpanes=0&scrollbar=0&zoom=page-fit&view=FitH`}
                className="lasm-preview-frame"
              />
              {wrapWidthPx > 0 && (
                <div
                  className="lasm-sig-overlay"
                  style={{ left: leftPx, top: topPx, width: widthPx, height: heightPx }}
                  onPointerDown={(e) => onSigPointerDown(e, 'move')}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    const step = e.altKey ? 10 : e.shiftKey ? 5 : 1;
                    if (e.key === 'ArrowUp')    { e.preventDefault(); updateSettings({ y: Math.max(0, settings.y - step) }); }
                    if (e.key === 'ArrowDown')  { e.preventDefault(); updateSettings({ y: Math.max(0, settings.y + step) }); }
                    if (e.key === 'ArrowLeft')  { e.preventDefault(); updateSettings({ x: Math.max(0, settings.x - step) }); }
                    if (e.key === 'ArrowRight') { e.preventDefault(); updateSettings({ x: Math.max(0, settings.x + step) }); }
                  }}
                  title="Drag to move, arrow keys to nudge (Shift = 5pt, Alt = 10pt)"
                >
                  <div className="lasm-sig-label">Signature</div>
                  <div className="lasm-sig-page">page {settings.page + 1}</div>
                  <div className="lasm-sig-resize" onPointerDown={(e) => onSigPointerDown(e, 'resize')} aria-label="Resize signature" />
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="lasm-coord-pane">
          <div className="lasm-coord-head">Signature Position</div>
          <div className="lasm-coord-help">
            Drag the box on the preview to reposition. The corner handle
            resizes it. Change <strong>Page</strong> to switch the
            preview to the page you're positioning on.
          </div>

          <label className="lasm-coord-row">
            <span>Page</span>
            <input type="number" min={1} value={(settings.page ?? 0) + 1}
                   onChange={(e) => updateSettings({ page: Math.max(0, (Number(e.target.value) || 1) - 1) })} />
          </label>
          {(['X', 'Y'] as const).map(axis => {
            const key = axis.toLowerCase() as 'x' | 'y';
            const value = Math.round(settings[key]);
            return (
              <label key={axis} className="lasm-coord-row">
                <span>{axis}</span>
                <input type="number" min={0} value={value}
                       onChange={(e) => updateSettings({ [key]: Math.max(0, Number(e.target.value) || 0) } as Partial<DocSettings>)} />
              </label>
            );
          })}
          <label className="lasm-coord-row">
            <span>Width</span>
            <input type="number" min={20} value={Math.round(settings.width)}
                   onChange={(e) => updateSettings({ width: Math.max(20, Number(e.target.value) || 20) })} />
          </label>
          <label className="lasm-coord-row">
            <span>Height</span>
            <input type="number" min={20} value={Math.round(settings.height)}
                   onChange={(e) => updateSettings({ height: Math.max(20, Number(e.target.value) || 20) })} />
          </label>

          <button type="button" className="lasm-reset" onClick={() => updateSettings(DEFAULT_SIG)}>
            Reset to default
          </button>

          <div className="lasm-recipient-card">
            <div className="lasm-recipient-h">Signers</div>
            {recipientName && (
              <div className="lasm-recipient-row">
                <span className="lasm-recipient-role">Buyer</span>
                <span className="lasm-recipient-name">{recipientName}</span>
                <span className="lasm-recipient-email">{recipientEmail || '—'}</span>
              </div>
            )}
            {consigneeName && /Consignee/i.test(agreement.party) && (
              <div className="lasm-recipient-row">
                <span className="lasm-recipient-role">Consignee</span>
                <span className="lasm-recipient-name">{consigneeName}</span>
                <span className="lasm-recipient-email">{consigneeEmail || '—'}</span>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
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

/* ── Posing pane (preview + draggable sig box) ── */
.lasm-shell:has(.lasm-posing) { max-width: 1280px; }
.lasm-posing { display: flex; flex-direction: column; min-height: 560px; }
.lasm-posing-bar { display: flex; align-items: center; gap: 14px; padding: 12px 22px;
  background: linear-gradient(110deg,#f8fafc,#eef2f7); border-bottom: 1px solid #e2e8f0; }
.lasm-posing-back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px;
  background: #fff; border: 1px solid #e2e8f0; color: #475569; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: border-color .15s ease, color .15s ease; }
.lasm-posing-back:hover:not(:disabled) { border-color: #0e7490; color: #0e7490; }
.lasm-posing-back:disabled { opacity: .55; cursor: not-allowed; }
.lasm-posing-title { flex: 1; min-width: 0; }
.lasm-posing-doc { font-size: 13px; font-weight: 800; color: #0c4a6e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lasm-posing-sub { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
.lasm-posing-send { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 9px;
  background: linear-gradient(135deg,#06b6d4,#0e7490); color: #fff; border: none; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
.lasm-posing-send:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(8,145,178,.30); }
.lasm-posing-send:disabled { opacity: .55; cursor: not-allowed; }

.lasm-posing-body { display: grid; grid-template-columns: 1fr 260px; gap: 0; flex: 1; min-height: 480px; }
.lasm-preview-pane { padding: 14px 18px; background: #f1f5f9; display: flex; align-items: flex-start; justify-content: center; overflow: auto; }
.lasm-preview-state { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }
.lasm-preview-wrap { position: relative; width: 100%; max-width: 560px; aspect-ratio: ${A4_W} / ${A4_H};
  background: #fff; box-shadow: 0 6px 18px rgba(15,23,42,.18); border-radius: 4px; overflow: hidden; }
.lasm-preview-frame { width: 100%; height: 100%; border: 0; display: block; }
.lasm-sig-overlay { position: absolute; z-index: 10;
  border: 2px dashed #0e7490; background: rgba(6,182,212,.16);
  display: flex; align-items: center; justify-content: center; cursor: move; user-select: none; }
.lasm-sig-overlay:focus { outline: 2px solid #0e7490; outline-offset: 2px; }
.lasm-sig-label { font-size: 11px; font-weight: 700; color: #0e7490; pointer-events: none; }
.lasm-sig-page { position: absolute; top: -18px; left: 0; font-size: 10px; font-weight: 700; color: #0e7490;
  background: #cffafe; border: 1px solid #67e8f9; border-radius: 3px; padding: 1px 5px; pointer-events: none; }
.lasm-sig-resize { position: absolute; right: -2px; bottom: -2px; width: 14px; height: 14px;
  background: #0e7490; border: 2px solid #fff; border-radius: 2px; cursor: nwse-resize; }

.lasm-coord-pane { padding: 16px 18px; border-left: 1px solid #e2e8f0; background: #fff; overflow: auto; }
.lasm-coord-head { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0e7490; margin-bottom: 8px; }
.lasm-coord-help { font-size: 11.5px; color: #64748b; line-height: 1.45; margin-bottom: 14px; }
.lasm-coord-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; }
.lasm-coord-row > span { font-size: 11.5px; font-weight: 600; color: #475569; }
.lasm-coord-row input { width: 92px; padding: 5px 8px; border: 1px solid #e2e8f0; border-radius: 6px;
  font-family: inherit; font-size: 12px; color: #0c4a6e; }
.lasm-coord-row input:focus { outline: none; border-color: #67e8f9; box-shadow: 0 0 0 2px rgba(103,232,249,.25); }
.lasm-reset { width: 100%; margin-top: 8px; padding: 7px 10px; border-radius: 7px;
  background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: background .15s ease; }
.lasm-reset:hover { background: #e2e8f0; }
.lasm-recipient-card { margin-top: 16px; padding: 12px; background: linear-gradient(110deg,#f0fdff,#ecfeff); border: 1px solid #cffafe; border-radius: 9px; }
.lasm-recipient-h { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #0e7490; margin-bottom: 8px; }
.lasm-recipient-row { display: flex; flex-direction: column; gap: 1px; padding: 6px 0; border-top: 1px dashed rgba(8,145,178,.18); }
.lasm-recipient-row:first-of-type { border-top: 0; padding-top: 0; }
.lasm-recipient-role { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #0e7490; }
.lasm-recipient-name { font-size: 12px; font-weight: 700; color: #0c4a6e; }
.lasm-recipient-email { font-size: 11px; color: #475569; }
`;
