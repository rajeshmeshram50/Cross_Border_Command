import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore — Vite's ?worker&url import handled at build time
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import {
  SSF_CSS, A4_W, A4_H, SIGNER_DEFAULTS,
  type DocSettings,
} from '../../SalesCustomerSendForSignatureModal';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker as unknown as string;

/* This modal reuses the agreement modal's CSS, whose `.ssf-step2` grid
 * reserves a left column for a document rail (220px | 1fr | 280px). We
 * don't have a rail (single doc), so collapse to a 2-column layout
 * (preview | position pane) — otherwise the preview is crushed into the
 * narrow rail column. Scoped via the extra `sds-step2` class. */
const SDS_CSS = `
.sds-step2 { grid-template-columns: 1fr 320px; }
.sds-step2 .ssf-preview-wrap { max-width: 640px; }
@media (max-width: 900px) { .sds-step2 { grid-template-columns: 1fr; } }
.sds-pagenav { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.sds-pagenav-label { font-size: 12.5px; font-weight: 700; color: #334155; min-width: 92px; text-align: center; }
.sds-pagenav-btn {
  border: 1.5px solid #cbd5e1; background: #fff; color: #0f172a;
  border-radius: 8px; padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.sds-pagenav-btn:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.sds-pagenav-btn:disabled { opacity: .45; cursor: not-allowed; }
[data-bs-theme="dark"] .sds-pagenav-label { color: #cbd5e1; }
[data-bs-theme="dark"] .sds-pagenav-btn { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .sds-pagenav-btn:hover:not(:disabled) { background: #243244; }
/* Preview canvas area — the shared .ssf-preview-pane is a light grey; in
   dark mode give it a dark backdrop so the white page reads as a sheet on
   a dark desk instead of a light-grey block. */
[data-bs-theme="dark"] .sds-step2 .ssf-preview-pane { background: #0b1220; }
[data-bs-theme="dark"] .sds-step2 .ssf-preview-state { color: #94a3b8; }
[data-bs-theme="dark"] .sds-step2 .ssf-preview-wrap { box-shadow: 0 12px 32px rgba(0, 0, 0, .55); }
/* Right "Signature Position · Customer" pane — fill the gaps the shared
   dark theme leaves (label text, Reset button, nudge buttons, hint box,
   Expiry + Notes fields) so the whole column is dark-consistent. */
[data-bs-theme="dark"] .sds-step2 .ssf-rail-head { color: #e2e8f0; }
[data-bs-theme="dark"] .sds-step2 .ssf-coord-row,
[data-bs-theme="dark"] .sds-step2 .ssf-coord-row span { color: #e2e8f0; }
[data-bs-theme="dark"] .sds-step2 .ssf-coord-help { color: #94a3b8; }
[data-bs-theme="dark"] .sds-step2 .ssf-nudge-btn { background: #0f172a; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .sds-step2 .ssf-nudge-btn:hover { background: #243244; color: #c7d2fe; border-color: #4338ca; }
[data-bs-theme="dark"] .sds-step2 .ssf-coord-hint { background: #0f172a; border-color: #334155; color: #94a3b8; }
[data-bs-theme="dark"] .sds-step2 .ssf-reset-btn { background: #0f172a; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .sds-step2 .ssf-reset-btn:hover { background: #243244; }
[data-bs-theme="dark"] .sds-step2 .ssf-recipient-h { color: #94a3b8; }
[data-bs-theme="dark"] .sds-step2 .ssf-recipient-email { color: #94a3b8; }
[data-bs-theme="dark"] .sds-step2 .ssf-options { color: #cbd5e1; }
[data-bs-theme="dark"] .sds-step2 .ssf-options input,
[data-bs-theme="dark"] .sds-step2 .ssf-notes-label textarea { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .sds-step2 .ssf-notes-label span,
[data-bs-theme="dark"] .sds-step2 .ssf-inline label span { color: #94a3b8; }
`;

/* ──────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Stage 5 → Send for Signature (Zoho Sign).
 *
 * A focused, single-step sibling of SalesCustomerSendForSignatureModal: it
 * sends ONE Quotation / Proforma Invoice for e-signature. Business rule:
 * the ONLY signer is the customer's primary contact person (no consignee).
 * Its email/name are resolved server-side from the customer's primary
 * contact, so this modal only positions the signature box + sets options.
 * Reuses the agreement modal's CSS + geometry constants for visual + coord
 * parity; only the preview source + send endpoint differ.
 *
 *   Preview: POST /sales/{quotations|proforma-invoices}/{id}/preview-pdf
 *   Send:    POST /clm/signature-requests/sales-doc-send
 * ────────────────────────────────────────────────────────────────────────── */

type SignerRole = 'buyer';

interface Props {
  open: boolean;
  kind: 'quotation' | 'pi';
  docId: number;
  docCode: string | null;
  leadId: number;
  /** Display name for the signer chip (the actual contact email/name is
   *  resolved server-side from the customer's primary contact). */
  customerName?: string | null;
  onClose: () => void;
  onSent?: () => void;
}

const ROLE_LABEL: Record<SignerRole, string> = { buyer: 'Customer' };

export default function SalesDocSendForSignatureModal({
  open, kind, docId, docCode, leadId, customerName, onClose, onSent,
}: Props) {
  const toast = useToast();

  // Quotation/PI signing always goes to a single signer — the customer's
  // primary contact person.
  const roles: SignerRole[] = ['buyer'];

  const [settings, setSettings] = useState<Partial<Record<SignerRole, DocSettings>>>({});
  const [activeRole, setActiveRole] = useState<SignerRole | null>(null);
  const [pdfReady, setPdfReady] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [expiryDays, setExpiryDays] = useState(30);
  const [notes, setNotes] = useState('Please review and sign this document.');
  const [sending, setSending] = useState(false);
  const [wrapWidthPx, setWrapWidthPx] = useState(0);

  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Loaded pdf.js document + the in-flight render task (so page/size
  // changes can cancel the previous render — pdf.js rejects rendering
  // onto a canvas that's still mid-render).
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const dragStateRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; initial: DocSettings } | null>(null);

  /* ── Seed per-role coords on open. */
  useEffect(() => {
    if (!open) return;
    const seeded: Partial<Record<SignerRole, DocSettings>> = {};
    roles.forEach(r => { seeded[r] = { ...SIGNER_DEFAULTS[r] }; });
    setSettings(seeded);
    setActiveRole(roles[0] ?? null);
    setExpiryDays(30);
    setNotes('Please review and sign this document.');
    setPdfReady(false);
    setPageCount(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docId]);

  /* ── Escape closes (unless mid-send). */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onClose]);

  /* ── Fetch + load the sales PDF into pdf.js (one document, rendered a
   * single page at a time onto a canvas — no <iframe>, so no second
   * browser PDF scrollbar). */
  useEffect(() => {
    if (!open) return;
    const endpoint = kind === 'pi'
      ? `/sales/proforma-invoices/${docId}/preview-pdf`
      : `/sales/quotations/${docId}/preview-pdf`;
    let cancelled = false;
    setPreviewLoading(true);
    setPdfReady(false);
    api.post(endpoint, { signature: true }, { responseType: 'blob' })
      .then(async r => {
        if (cancelled) return;
        const buf = await (r.data as Blob).arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) { pdf.destroy(); return; }
        try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
        pdfDocRef.current = pdf;
        setPageCount(Math.max(1, pdf.numPages));
        setPdfReady(true);
      })
      .catch(() => { if (!cancelled) toast.error('Preview failed', 'Could not render the document.'); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, docId]);

  // Tear down the pdf.js document when the modal unmounts/closes.
  useEffect(() => () => {
    try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
    try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
    pdfDocRef.current = null;
  }, []);

  const activePage = activeRole ? (settings[activeRole]?.page ?? 0) : 0;

  /* ── Render the active page onto the canvas at the wrapper's width.
   * Re-runs when the page changes, the doc loads, or the box is resized. */
  useEffect(() => {
    if (!pdfReady || !open) return;
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    const wrap = previewWrapRef.current;
    if (!pdf || !canvas || !wrap) return;
    const cssWidth = wrap.clientWidth || wrapWidthPx;
    if (cssWidth <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pageNum = Math.min(pdf.numPages, Math.max(1, activePage + 1));
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = (cssWidth / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch { /* cancelled renders throw — safe to ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfReady, activePage, wrapWidthPx, open]);

  /* ── Track preview wrapper width so the overlay aligns from first paint. */
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    setWrapWidthPx(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => { for (const e of entries) setWrapWidthPx(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfReady]);

  const activeSettings: DocSettings | null = activeRole ? (settings[activeRole] ?? { ...SIGNER_DEFAULTS[activeRole] }) : null;

  const updateActiveSettings = (patch: Partial<DocSettings>) => {
    if (!activeRole) return;
    setSettings(prev => {
      const cur = prev[activeRole] ?? { ...SIGNER_DEFAULTS[activeRole] };
      return { ...prev, [activeRole]: { ...cur, ...patch } };
    });
  };

  // Move the active signer's signature box (and the preview) to another page.
  const goPage = (delta: number) =>
    updateActiveSettings({ page: clampPage((activeSettings?.page ?? 0) + delta) });
  const clampPage = (p: number) => Math.max(0, Math.min(pageCount - 1, p));

  /* ── Drag math — identical to the agreement picker (A4 aspect, top-left
   * origin matching Zoho's signature-field coords). */
  const wrapperPtPerPx = () => {
    const w = wrapWidthPx || previewWrapRef.current?.clientWidth || 0;
    return w > 0 ? A4_W / w : 0;
  };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onSigPointerMove = (e: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const ptPerPx = wrapperPtPerPx();
    if (ptPerPx <= 0) return;
    const dxPt = (e.clientX - drag.startX) * ptPerPx;
    const dyPt = (e.clientY - drag.startY) * ptPerPx;
    if (drag.mode === 'move') {
      updateActiveSettings({
        x: clamp(drag.initial.x + dxPt, 0, A4_W - drag.initial.width),
        y: clamp(drag.initial.y + dyPt, 0, A4_H - drag.initial.height),
      });
    } else {
      updateActiveSettings({
        width:  clamp(drag.initial.width  + dxPt, 40, A4_W - drag.initial.x),
        height: clamp(drag.initial.height + dyPt, 24, A4_H - drag.initial.y),
      });
    }
  };
  const onSigPointerUp = () => {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', onSigPointerMove);
    window.removeEventListener('pointerup', onSigPointerUp);
  };
  const onSigPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!activeSettings) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStateRef.current = { mode, startX: e.clientX, startY: e.clientY, initial: { ...activeSettings } };
    window.addEventListener('pointermove', onSigPointerMove);
    window.addEventListener('pointerup', onSigPointerUp);
  };

  const send = async () => {
    setSending(true);
    try {
      // Coords keyed by doc id → { role → {x,y,page,w,h} }. Signers are
      // omitted so the backend resolves the customer/consignee emails
      // authoritatively from the document itself.
      const documentSettings: Record<number, Record<string, DocSettings>> = {
        [docId]: roles.reduce((acc, r) => {
          acc[r] = settings[r] ?? { ...SIGNER_DEFAULTS[r] };
          return acc;
        }, {} as Record<string, DocSettings>),
      };
      const r = await api.post('/clm/signature-requests/sales-doc-send', {
        doc_kind:          kind === 'pi' ? 'proforma_invoice' : 'quotation',
        doc_id:            docId,
        lead_id:           leadId,
        document_settings: documentSettings,
        expiry_days:       expiryDays,
        notes:             notes.trim(),
      });
      toast.success('Sent for signature', r.data?.message ?? 'Document sent to the signer(s).');
      onSent?.();
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message
        || (e?.response?.data?.errors && Object.values(e.response.data.errors).flat().join(' · '))
        || 'Failed to send the document for signature.';
      toast.error('Send failed', msg);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const label = kind === 'pi' ? 'Proforma Invoice' : 'Quotation';
  const roleName = (_r: SignerRole) => customerName || 'Customer';

  return createPortal(
    <div className="ssf-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }} role="dialog" aria-modal="true">
      <style>{SSF_CSS}{SDS_CSS}</style>
      <div className="ssf-shell" onMouseDown={e => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="ssf-head">
          <div className="ssf-head-left">
            <div className="ssf-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34" />
                <polygon points="18 2 22 6 12 16 8 16 8 12 18 2" />
              </svg>
            </div>
            <div>
              <div className="ssf-head-label">SEND {label.toUpperCase()} FOR SIGNATURE</div>
              <div className="ssf-head-title">{docCode || label}</div>
              <div className="ssf-head-sub">{roles.map(r => ROLE_LABEL[r]).join(' + ')} · {roles.length} signer{roles.length > 1 ? 's' : ''}</div>
            </div>
          </div>
          <button type="button" className="ssf-close" onClick={() => !sending && onClose()} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="ssf-body">
          <div className="ssf-step2 sds-step2">
            <div className="ssf-preview-pane">
              {previewLoading && <div className="ssf-preview-state">Rendering preview…</div>}
              {!previewLoading && !pdfReady && <div className="ssf-preview-state">Preview unavailable.</div>}
              {pdfReady && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                  {/* Page navigator — flip through the document pages and
                      drop the signature box on whichever page you want. */}
                  <div className="sds-pagenav">
                    <button type="button" className="sds-pagenav-btn" onClick={() => goPage(-1)} disabled={(activeSettings?.page ?? 0) <= 0} aria-label="Previous page">‹ Prev</button>
                    <span className="sds-pagenav-label">Page {(activeSettings?.page ?? 0) + 1} of {pageCount}</span>
                    <button type="button" className="sds-pagenav-btn" onClick={() => goPage(1)} disabled={(activeSettings?.page ?? 0) >= pageCount - 1} aria-label="Next page">Next ›</button>
                  </div>

                  <div className="ssf-preview-wrap" ref={previewWrapRef}>
                    <canvas ref={canvasRef} className="ssf-preview-frame" />
                    {previewLoading && <div className="ssf-preview-state" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Rendering…</div>}
                    {wrapWidthPx > 0 && (() => {
                      const pxPerPt = wrapWidthPx / A4_W;
                      const visiblePage = activeSettings?.page ?? 0;
                      return roles.map(r => {
                        const ds = settings[r] ?? SIGNER_DEFAULTS[r];
                        if (ds.page !== visiblePage) return null;
                        const isActive = r === activeRole;
                        return (
                          <div
                            key={r}
                            className={`ssf-sig-overlay ssf-sig-overlay-${r} ${isActive ? 'is-active' : 'is-dim'}`}
                            style={{ left: ds.x * pxPerPt, top: ds.y * pxPerPt, width: ds.width * pxPerPt, height: ds.height * pxPerPt }}
                            onPointerDown={e => { if (!isActive) { e.stopPropagation(); setActiveRole(r); return; } onSigPointerDown(e, 'move'); }}
                            tabIndex={isActive ? 0 : -1}
                            onKeyDown={e => {
                              if (!isActive) return;
                              const step = e.altKey ? 10 : e.shiftKey ? 5 : 1;
                              if (e.key === 'ArrowUp')    { e.preventDefault(); updateActiveSettings({ y: Math.max(0, ds.y - step) }); }
                              if (e.key === 'ArrowDown')  { e.preventDefault(); updateActiveSettings({ y: Math.max(0, ds.y + step) }); }
                              if (e.key === 'ArrowLeft')  { e.preventDefault(); updateActiveSettings({ x: Math.max(0, ds.x - step) }); }
                              if (e.key === 'ArrowRight') { e.preventDefault(); updateActiveSettings({ x: Math.max(0, ds.x + step) }); }
                            }}
                            title={isActive ? 'Drag to move' : `Click to switch to ${ROLE_LABEL[r]}`}
                          >
                            <div className="ssf-sig-label"><span className={`ssf-signer-dot ssf-signer-dot-${r}`} /> {ROLE_LABEL[r]}</div>
                            <div className="ssf-sig-page">page {ds.page + 1}</div>
                            {isActive && <div className="ssf-sig-resize" onPointerDown={e => onSigPointerDown(e, 'resize')} aria-label="Resize signature" />}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right rail: position + options ── */}
            <aside className="ssf-coord-pane">
              <div className="ssf-rail-head">Signature Position{activeRole ? ` · ${ROLE_LABEL[activeRole]}` : ''}</div>
              <div className="ssf-coord-help">
                Drag the box on the preview to reposition. The corner handle resizes it.
                Change <strong>Page</strong> to position on a different page.
              </div>

              {activeSettings && (
                <>
                  <label className="ssf-coord-row">
                    <span>Page <small style={{ color: '#94a3b8', fontWeight: 400 }}>of {pageCount}</small></span>
                    <input
                      type="number" min={1} max={pageCount}
                      value={Math.min(pageCount, (activeSettings.page ?? 0) + 1)}
                      onChange={e => updateActiveSettings({ page: Math.max(1, Math.min(pageCount, Number(e.target.value) || 1)) - 1 })}
                    />
                  </label>
                  {(['X', 'Y'] as const).map(axis => {
                    const key = axis.toLowerCase() as 'x' | 'y';
                    const value = Math.round(activeSettings[key] ?? 0);
                    const step = (m: { shiftKey: boolean; altKey: boolean }) => m.altKey ? 10 : m.shiftKey ? 5 : 1;
                    return (
                      <div className="ssf-coord-row ssf-coord-row-nudge" key={axis}>
                        <span>{axis}</span>
                        <div className="ssf-coord-nudge-group">
                          <button type="button" className="ssf-nudge-btn" onClick={e => updateActiveSettings({ [key]: Math.max(0, value - step(e)) } as any)}>▼</button>
                          <input type="number" min={0} step={1} value={value} onChange={e => updateActiveSettings({ [key]: Math.max(0, Number(e.target.value) || 0) } as any)} />
                          <button type="button" className="ssf-nudge-btn" onClick={e => updateActiveSettings({ [key]: Math.max(0, value + step(e)) } as any)}>▲</button>
                        </div>
                      </div>
                    );
                  })}
                  <label className="ssf-coord-row"><span>Width</span><input type="number" min={20} value={Math.round(activeSettings.width)} onChange={e => updateActiveSettings({ width: Math.max(20, Number(e.target.value) || 20) })} /></label>
                  <label className="ssf-coord-row"><span>Height</span><input type="number" min={20} value={Math.round(activeSettings.height)} onChange={e => updateActiveSettings({ height: Math.max(20, Number(e.target.value) || 20) })} /></label>
                  <button type="button" className="ssf-reset-btn" onClick={() => activeRole && updateActiveSettings({ ...SIGNER_DEFAULTS[activeRole] })}>Reset to default</button>
                </>
              )}

              <div className="ssf-recipient-card">
                <div className="ssf-recipient-h">Signer</div>
                {roles.map(r => (
                  <div key={r} style={{ marginBottom: 6 }}>
                    <div className="ssf-recipient-name"><span className={`ssf-signer-dot ssf-signer-dot-${r}`} style={{ marginRight: 6 }} />{ROLE_LABEL[r]} · {roleName(r)}</div>
                    <div className="ssf-recipient-email">Sent to &amp; signed by the customer's primary contact person (email from the customer record).</div>
                  </div>
                ))}
                <div className="ssf-options">
                  <div className="ssf-inline">
                    <label><span>Expiry (days)</span>
                      <input type="number" min={1} max={180} value={expiryDays} onChange={e => setExpiryDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} />
                    </label>
                  </div>
                  <label className="ssf-notes-label"><span>Notes to signers</span>
                    <textarea rows={2} value={notes} maxLength={1000} onChange={e => setNotes(e.target.value.slice(0, 1000))} />
                  </label>
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="ssf-foot">
          <div className="ssf-foot-left" />
          <div className="ssf-foot-right">
            <button type="button" className="ssf-btn ssf-btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
            <button type="button" className="ssf-btn ssf-btn-primary" disabled={sending} onClick={send}>
              {sending ? 'Sending…' : `Send ${label} for Signature`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
