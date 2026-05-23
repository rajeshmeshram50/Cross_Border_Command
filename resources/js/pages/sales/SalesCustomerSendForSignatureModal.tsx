import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
// Vite-friendly worker URL — Bundles pdfjs's worker as a separate chunk
// so the main bundle stays small. Without this, pdfjs falls back to a
// fake worker on the main thread and warns loudly.
// @ts-ignore — Vite's ?worker&url import handled at build time
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

// One-time pdfjs setup — the worker URL is the same for every modal
// instance, so we set it at module scope to avoid re-assigning per open.
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker as unknown as string;

/* ──────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Customers → Send for Signature (Zoho Sign).
 *
 * Three-step wizard:
 *   1. Pick documents + recipients   (up to 10 drafts × up to 5 signers)
 *   2. Preview & position signature  (per-doc x/y/page/width/height with a
 *                                     mini A4 map; iframe shows the live PDF)
 *   3. Review & send                  (summary + the actual API call)
 *
 * Backed by:
 *   POST /api/clm/signature-requests/preview   — returns one PDF blob
 *   POST /api/clm/signature-requests           — creates + submits to Zoho
 * Both endpoints are tenant-scoped server-side via the user's client_id.
 * ────────────────────────────────────────────────────────────────────────── */

export type SendForSignatureCustomer = {
  id: string;
  db_id?: number;
  company: string;
  contact?: string;
  email?: string;
};

type TradeDoc = {
  id: number;
  code: string;
  name: string;
  title: string;
  doc_type?: string;
  purpose?: string;
  party?: string;
};

type Signer = {
  email: string;
  name: string;
  order?: number;
};

type DocSettings = {
  x: number;
  y: number;
  page: number;
  width: number;
  height: number;
};

const DEFAULTS: DocSettings = { x: 380, y: 720, page: 0, width: 150, height: 45 };

// A4 in PDF points (1pt = 1/72in)
const A4_W = 595;
const A4_H = 842;

interface Props {
  open: boolean;
  customer: SendForSignatureCustomer | null;
  onClose: () => void;
  onSent?: (sentDocIds: number[]) => void;
  /** Pre-checked Trade Document IDs when launched from the party's
   * Stage 3 Trade Documents tab — the user can still toggle them off
   * or add more before sending. */
  preselectedDocIds?: number[];
  /** Party model the send is bound to — drives both the request body's
   * `model_name` and which token namespace gets resolved by the
   * controller's replacePlaceholders. Defaults to 'Customer' for the
   * existing caller. */
  modelName?: 'Customer' | 'Consignee' | 'Vendor';
}

export default function SalesCustomerSendForSignatureModal({ open, customer, onClose, onSent, preselectedDocIds, modelName = 'Customer' }: Props) {
  const toast = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [docs, setDocs] = useState<TradeDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [signers, setSigners] = useState<Signer[]>([]);
  const [isSequential, setIsSequential] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);
  const [notes, setNotes] = useState('Please review and sign these documents.');

  const [settings, setSettings] = useState<Record<number, DocSettings>>({});
  const [activeDocId, setActiveDocId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /* Total page count of the active doc's preview PDF — populated by the
   * PDF.js loader so the page input can be range-limited and a "page X
   * of Y" hint can be shown. Kept per modal-open (no per-doc map needed
   * since switching docs reloads the preview anyway). */
  const [pageCount, setPageCount] = useState<number>(1);

  const [sending, setSending] = useState(false);

  /* ── Reset when the modal opens. Trigger ONLY on the `open` edge and
   * when the bound customer.db_id actually changes — NOT on every parent
   * render. The parent (AddCustomerModal) recreates its `customer` prop
   * on each render (form edits, polling, etc.); if we depended on the
   * object reference, the modal would re-reset state + re-fetch the
   * preview + nuke the user's drag positioning multiple times a second.
   * The primitive db_id is what genuinely identifies a "different
   * customer" worth re-initialising for. */
  useEffect(() => {
    if (!open) return;
    const hasPreselected = Array.isArray(preselectedDocIds) && preselectedDocIds.length > 0;
    setStep(hasPreselected ? 2 : 1);
    setSelectedIds(hasPreselected ? preselectedDocIds!.slice(0, 10) : []);
    setSigners(customer
      ? [{ name: (customer.contact || customer.company || '').trim() || 'Signer 1', email: (customer.email || '').trim(), order: 1 }]
      : [{ name: '', email: '', order: 1 }],
    );
    setIsSequential(false);
    setExpiryDays(30);
    setNotes('Please review and sign these documents.');
    setSettings({});
    setActiveDocId(null);
    setPreviewUrl(null);
    userOverrodeRef.current.clear();
  // preselectedDocIds and customer are read at open-time only —
  // intentionally excluded from deps. db_id captures "different customer".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.db_id]);

  /* ── Fetch the trade-doc library when the modal opens (cached for the
   * lifetime of the modal — re-fetched on next open). The for-party
   * filter is tied to the modelName so the picker only surfaces drafts
   * declared applicable to this party type. */
  const partyFilter = modelName === 'Customer' ? 'buyer' : modelName === 'Consignee' ? 'consignee' : 'supplier';
  const partyToken: 'customer' | 'consignee' | 'supplier' =
    modelName === 'Customer' ? 'customer' : modelName === 'Consignee' ? 'consignee' : 'supplier';

  useEffect(() => {
    if (!open) return;
    setDocsLoading(true);
    api.get(`/clm/trade-doc-library/for-party/${partyFilter}`)
      .then(r => setDocs(Array.isArray(r.data?.data) ? r.data.data : []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [open, partyFilter]);

  /* ── Escape closes the modal whenever we're not mid-send. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, sending, onClose]);

  /* ── Default signature placement seeds on selection change so step 2
   * always has coords to render before the user touches anything. */
  useEffect(() => {
    setSettings(prev => {
      const next: Record<number, DocSettings> = { ...prev };
      selectedIds.forEach(id => { if (!next[id]) next[id] = { ...DEFAULTS }; });
      Object.keys(next).forEach(k => {
        const n = Number(k);
        if (!selectedIds.includes(n)) delete next[n];
      });
      return next;
    });
    if (selectedIds.length === 0) setActiveDocId(null);
    else if (!activeDocId || !selectedIds.includes(activeDocId)) setActiveDocId(selectedIds[0]);
  }, [selectedIds, activeDocId]);

  const selectedDocs = useMemo(() => selectedIds.map(id => docs.find(d => d.id === id)).filter(Boolean) as TradeDoc[], [selectedIds, docs]);

  /* Per-document set tracking whether the user has manually overridden
   * the signature box. Once they drag the overlay, we stop auto-snapping
   * back to the placeholder-detected position on subsequent fetches —
   * the dragged value is what they meant to use. */
  const userOverrodeRef = useRef<Set<number>>(new Set());

  /* ── Re-render the preview blob when step 2 changes its active doc.
   * After the PDF lands we also run a PDF.js pass over the bytes to find
   * the «CBC-SIG-CUSTOMER-9417» marker the controller embedded inside the
   * sig-box — that position becomes the default for the draggable
   * overlay. Detection is best-effort: if it fails, we fall back to the
   * pre-existing default (bottom-right of page 1). */
  useEffect(() => {
    if (step !== 2 || !activeDocId || !customer?.db_id) return;
    const docId = activeDocId;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewUrl(null);
    api.post('/clm/signature-requests/preview',
      { trade_doc_id: docId, party_id: customer.db_id, model_name: modelName },
      { responseType: 'blob' },
    )
      .then(async r => {
        if (cancelled) return;
        const blob = r.data as Blob;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);

        // Detect placeholder coords. Only auto-apply when the user
        // hasn't dragged this doc's overlay yet. Page count comes out
        // of the same PDF.js load — fed into a state so the page input
        // can be clamped and the "page X of Y" hint stays accurate.
        if (userOverrodeRef.current.has(docId)) return;
        try {
          const detected = await detectSignatureMarker(blob, partyToken, (n) => {
            if (!cancelled) setPageCount(Math.max(1, n));
          });
          if (cancelled || !detected) return;
          setSettings(prev => ({
            ...prev,
            [docId]: { ...DEFAULTS, ...prev[docId], ...detected },
          }));
        } catch {
          // Detection failed (e.g., corrupted PDF, worker init issue).
          // Silently keep the previous defaults — the user can still drag.
        }
      })
      .catch(() => {
        if (!cancelled) toast.error('Preview failed', 'Could not render the document. Check the draft content.');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeDocId, customer?.db_id]);

  /* ── Release blob URLs we created so we don't leak memory. */
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const toggleDoc = (id: number) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 10) {
        toast.error('Limit reached', 'You can send at most 10 documents per request.');
        return prev;
      }
      return [...prev, id];
    });
  };

  const addSigner = () => {
    if (signers.length >= 5) {
      toast.error('Limit reached', 'You can configure at most 5 signers.');
      return;
    }
    setSigners(prev => [...prev, { name: '', email: '', order: prev.length + 1 }]);
  };

  const updateSigner = (idx: number, patch: Partial<Signer>) => {
    setSigners(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const removeSigner = (idx: number) => {
    setSigners(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };

  /* ── Validate step 1 → can proceed to step 2 */
  const step1Valid = selectedIds.length >= 1
    && signers.length >= 1
    && signers.every(s => s.name.trim() && /\S+@\S+\.\S+/.test(s.email.trim()));

  /* ── Send. */
  const send = async () => {
    if (!customer?.db_id) {
      toast.error('Missing customer', 'This customer is not saved yet.');
      return;
    }
    setSending(true);
    try {
      const payload = {
        trade_doc_ids: selectedIds,
        party_id: customer.db_id,
        model_name: modelName,
        signers: signers.map((s, i) => ({ ...s, name: s.name.trim(), email: s.email.trim(), order: s.order ?? i + 1 })),
        is_sequential: isSequential,
        expiry_days: expiryDays,
        notes: notes.trim(),
        document_settings: settings,
      };
      const r = await api.post('/clm/signature-requests', payload);
      const data = r.data?.data;
      toast.success('Sent for signature', `${data?.document_count ?? selectedIds.length} document(s) emailed to the signer.`);
      onSent?.(selectedIds.slice());
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message
        || (e?.response?.data?.errors && Object.values(e.response.data.errors).flat().join(' · '))
        || 'Failed to send. Check the server log for details.';
      toast.error('Send failed', msg);
    } finally {
      setSending(false);
    }
  };

  const activeSettings = activeDocId ? (settings[activeDocId] ?? { ...DEFAULTS }) : null;
  const updateActiveSettings = (patch: Partial<DocSettings>) => {
    if (!activeDocId) return;
    setSettings(prev => ({ ...prev, [activeDocId]: { ...DEFAULTS, ...prev[activeDocId], ...patch } }));
  };

  /* ── Drag-to-position the signature box on the live PDF preview.
   * The preview wrapper is sized to A4 aspect ratio (595×842), so the
   * px↔pt conversion is uniform on both axes: `ptPerPx = 595 / widthPx`.
   * PDF coords place origin at bottom-left, CSS places it at top-left,
   * so Y is mirrored when rendering and on mouseup. */
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    mode: 'move' | 'resize';
    startX: number; startY: number;
    initial: DocSettings;
  } | null>(null);
  /* Track the wrapper width via ResizeObserver so the overlay renders
   * correctly from the FIRST paint after the iframe loads, not after
   * a user interaction. Also keeps the overlay aligned when the modal
   * is resized via window resize / dark-mode toggle / etc. */
  const [wrapWidthPx, setWrapWidthPx] = useState(0);

  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    setWrapWidthPx(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setWrapWidthPx(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [step, previewUrl]);

  const wrapperSizePt = () => {
    const w = wrapWidthPx || previewWrapRef.current?.clientWidth || 0;
    if (w <= 0) return { w: 0, h: 0, ptPerPx: 0 };
    return { w, h: w * (A4_H / A4_W), ptPerPx: A4_W / w };
  };

  const onSigPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!activeSettings || !activeDocId) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    // First drag on this doc disables placeholder-detection auto-snap so
    // we don't fight the user's intent on the next preview load.
    userOverrodeRef.current.add(activeDocId);
    dragStateRef.current = {
      mode,
      startX: e.clientX, startY: e.clientY,
      initial: { ...activeSettings },
    };
    window.addEventListener('pointermove', onSigPointerMove);
    window.addEventListener('pointerup', onSigPointerUp);
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const onSigPointerMove = (e: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || !activeDocId) return;
    const { ptPerPx } = wrapperSizePt();
    if (ptPerPx <= 0) return;
    const dxPt = (e.clientX - drag.startX) * ptPerPx;
    const dyPt = (e.clientY - drag.startY) * ptPerPx;

    // Zoho's signature-field coords use a TOP-LEFT origin (y grows down),
    // matching CSS — so cursor-down (+dy) means y increases.
    if (drag.mode === 'move') {
      const x = clamp(drag.initial.x + dxPt, 0, A4_W - drag.initial.width);
      const y = clamp(drag.initial.y + dyPt, 0, A4_H - drag.initial.height);
      updateActiveSettings({ x, y });
    } else {
      // Resize from bottom-right: width grows with +dx, height grows
      // with +dy. Top-left (x, y) stays anchored.
      const width  = clamp(drag.initial.width  + dxPt, 40, A4_W - drag.initial.x);
      const height = clamp(drag.initial.height + dyPt, 24, A4_H - drag.initial.y);
      updateActiveSettings({ width, height });
    }
  };

  const onSigPointerUp = () => {
    dragStateRef.current = null;
    window.removeEventListener('pointermove', onSigPointerMove);
    window.removeEventListener('pointerup', onSigPointerUp);
  };

  if (!open) return null;

  // When opened from Stage 3 with documents already chosen, the modal
  // skips the picker entirely — show a single "preview & position" view
  // with Send as the action. The two-step stepper is hidden in that mode.
  const launchedFromStage3 = Array.isArray(preselectedDocIds) && preselectedDocIds.length > 0;

  return createPortal(
    <div className="ssf-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }} role="dialog" aria-modal="true">
      <style>{SSF_CSS}</style>
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
              <div className="ssf-head-label">SEND FOR SIGNATURE</div>
              <div className="ssf-head-title">{customer?.company || 'Customer'}</div>
              {customer?.email && <div className="ssf-head-sub">{customer.email}</div>}
            </div>
          </div>
          <button type="button" className="ssf-close" onClick={() => !sending && onClose()} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Stepper only shown for the standalone (no-preselection) path.
            When launched from Stage 3, documents are already chosen and
            the modal is a single Preview & Send screen — no stepper. */}
        {!launchedFromStage3 && (
          <div className="ssf-steps">
            {[
              { n: 1, label: 'Documents & Signers' },
              { n: 2, label: 'Preview & Send' },
            ].map(s => (
              <div key={s.n} className={`ssf-step ${step === s.n ? 'is-active' : ''} ${step > s.n ? 'is-done' : ''}`}>
                <span className="ssf-step-num">{step > s.n ? '✓' : s.n}</span>
                <span className="ssf-step-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        <div className="ssf-body">
          {step === 1 && (
            <div className="ssf-step1">
              <section className="ssf-block">
                <div className="ssf-block-head">
                  <div>
                    <div className="ssf-block-title">Pick Trade Documents</div>
                    <div className="ssf-block-sub">Select 1–10 drafts to send. Only Buyer-applicable drafts are shown.</div>
                  </div>
                  <div className="ssf-counter">{selectedIds.length}/10 selected</div>
                </div>
                {docsLoading && <div className="ssf-loading">Loading documents…</div>}
                {!docsLoading && docs.length === 0 && <div className="ssf-empty">No buyer-applicable trade documents found. Create one from Central CLM → Trade Documents.</div>}
                {!docsLoading && docs.length > 0 && (
                  <div className="ssf-doc-grid">
                    {docs.map(d => {
                      const checked = selectedIds.includes(d.id);
                      return (
                        <label key={d.id} className={`ssf-doc-card ${checked ? 'is-checked' : ''}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleDoc(d.id)} />
                          <div className="ssf-doc-card-body">
                            <div className="ssf-doc-card-code">{d.code}</div>
                            <div className="ssf-doc-card-title">{d.title || d.name}</div>
                            <div className="ssf-doc-card-meta">
                              {d.doc_type && <span className="ssf-chip">{d.doc_type}</span>}
                              {d.purpose && <span className="ssf-chip ssf-chip-muted" title={d.purpose}>{d.purpose.length > 28 ? d.purpose.slice(0, 28) + '…' : d.purpose}</span>}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="ssf-block">
                <div className="ssf-block-head">
                  <div>
                    <div className="ssf-block-title">Signers</div>
                    <div className="ssf-block-sub">Zoho will email these recipients. The first signer is pre-filled from the customer.</div>
                  </div>
                  <button type="button" className="ssf-add-btn" onClick={addSigner} disabled={signers.length >= 5}>
                    + Add Signer ({signers.length}/5)
                  </button>
                </div>
                <div className="ssf-signers">
                  {signers.map((s, i) => (
                    <div key={i} className="ssf-signer-row">
                      <span className="ssf-signer-order">{s.order ?? i + 1}</span>
                      <input type="text" placeholder="Name" value={s.name} onChange={e => updateSigner(i, { name: e.target.value })} />
                      <input type="email" placeholder="Email" value={s.email} onChange={e => updateSigner(i, { email: e.target.value })} />
                      {signers.length > 1 && (
                        <button type="button" className="ssf-signer-remove" onClick={() => removeSigner(i)} aria-label="Remove signer">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="ssf-options">
                  <label className="ssf-checkbox">
                    <input type="checkbox" checked={isSequential} onChange={e => setIsSequential(e.target.checked)} />
                    <span>Sequential signing (each signer waits for the previous one)</span>
                  </label>
                  <div className="ssf-inline">
                    <label>
                      <span>Expiry (days)</span>
                      <input type="number" min={1} max={180} value={expiryDays} onChange={e => setExpiryDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))} />
                    </label>
                  </div>
                  <label className="ssf-notes-label">
                    <span>Notes to signers</span>
                    <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value.slice(0, 1000))} maxLength={1000} />
                  </label>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="ssf-step2">
              <aside className="ssf-doc-rail">
                <div className="ssf-rail-head">Documents</div>
                {selectedDocs.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    className={`ssf-rail-item ${activeDocId === d.id ? 'is-active' : ''}`}
                    onClick={() => setActiveDocId(d.id)}
                  >
                    <span className="ssf-rail-code">{d.code}</span>
                    <span className="ssf-rail-name">{d.title || d.name}</span>
                  </button>
                ))}
              </aside>

              <div className="ssf-preview-pane">
                {previewLoading && <div className="ssf-preview-state">Rendering preview…</div>}
                {!previewLoading && !previewUrl && <div className="ssf-preview-state">Preview unavailable.</div>}
                {previewUrl && (
                  <div className="ssf-preview-wrap" ref={previewWrapRef}>
                    {/* PDF.js / native viewer behind; #toolbar=0&navpanes=0&scrollbar=0
                        strips the browser PDF chrome on Chromium so the page itself
                        fills the wrapper at A4 ratio. The draggable overlay sits
                        on top in the SAME coordinate space.
                        #page=N (1-indexed) syncs the visible page to the page
                        the user is positioning on — otherwise on multi-page
                        docs the user sees page 1 while their (x,y) is being
                        applied by Zoho to page 2, and the widget lands far
                        from where they dragged. Re-keying on page also
                        forces a reload when the page input changes. */}
                    <iframe
                      key={`${previewUrl}-p${activeSettings?.page ?? 0}`}
                      title="Preview"
                      src={`${previewUrl}#page=${(activeSettings?.page ?? 0) + 1}&toolbar=0&navpanes=0&scrollbar=0&zoom=page-fit&view=FitH`}
                      className="ssf-preview-frame"
                    />
                    {activeSettings && wrapWidthPx > 0 && (() => {
                      // Zoho field coords use TOP-LEFT origin (y grows down),
                      // matching CSS — so the conversion is a simple scale,
                      // no Y inversion. Render only once the wrapper has been
                      // measured so the box doesn't paint at 0×0 on the first
                      // frame before the ResizeObserver fires.
                      const pxPerPt  = wrapWidthPx / A4_W;
                      const leftPx   = activeSettings.x      * pxPerPt;
                      const topPx    = activeSettings.y      * pxPerPt;
                      const widthPx  = activeSettings.width  * pxPerPt;
                      const heightPx = activeSettings.height * pxPerPt;
                      return (
                        <div
                          className="ssf-sig-overlay"
                          style={{ left: leftPx, top: topPx, width: widthPx, height: heightPx }}
                          onPointerDown={e => onSigPointerDown(e, 'move')}
                        >
                          <div className="ssf-sig-label">Signature</div>
                          <div className="ssf-sig-page">page {activeSettings.page + 1}</div>
                          <div
                            className="ssf-sig-resize"
                            onPointerDown={e => onSigPointerDown(e, 'resize')}
                            aria-label="Resize signature"
                          />
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <aside className="ssf-coord-pane">
                <div className="ssf-rail-head">Signature Position</div>
                <div className="ssf-coord-help">
                  Drag the box on the preview to reposition the signature.
                  The corner handle resizes it. The preview jumps to the
                  page you're positioning on — change <strong>Page</strong>
                  to switch.
                </div>

                {activeSettings && (
                  <>
                    <label className="ssf-coord-row">
                      <span>Page <small style={{ color: '#94a3b8', fontWeight: 400 }}>of {pageCount}</small></span>
                      <input
                        type="number"
                        min={1}
                        max={pageCount}
                        // Display 1-indexed page numbers (matches what the user
                        // reads in the iframe), store 0-indexed in settings
                        // (matches Zoho's page_no convention).
                        value={Math.min(pageCount, (activeSettings.page ?? 0) + 1)}
                        onChange={e => {
                          const v = Number(e.target.value) || 1;
                          const clamped = Math.max(1, Math.min(pageCount, v));
                          updateActiveSettings({ page: clamped - 1 });
                        }}
                      />
                    </label>
                    <label className="ssf-coord-row">
                      <span>X</span>
                      <input type="number" min={0} value={Math.round(activeSettings.x)} onChange={e => updateActiveSettings({ x: Math.max(0, Number(e.target.value) || 0) })} />
                    </label>
                    <label className="ssf-coord-row">
                      <span>Y</span>
                      <input type="number" min={0} value={Math.round(activeSettings.y)} onChange={e => updateActiveSettings({ y: Math.max(0, Number(e.target.value) || 0) })} />
                    </label>
                    <label className="ssf-coord-row">
                      <span>Width</span>
                      <input type="number" min={20} value={Math.round(activeSettings.width)} onChange={e => updateActiveSettings({ width: Math.max(20, Number(e.target.value) || 20) })} />
                    </label>
                    <label className="ssf-coord-row">
                      <span>Height</span>
                      <input type="number" min={20} value={Math.round(activeSettings.height)} onChange={e => updateActiveSettings({ height: Math.max(20, Number(e.target.value) || 20) })} />
                    </label>

                    <button type="button" className="ssf-reset-btn" onClick={() => updateActiveSettings(DEFAULTS)}>
                      Reset to default
                    </button>
                  </>
                )}

                <div className="ssf-recipient-card">
                  <div className="ssf-recipient-h">Recipient</div>
                  <div className="ssf-recipient-name">{customer?.company || '—'}</div>
                  <div className="ssf-recipient-email">{customer?.email || '—'}</div>
                </div>
              </aside>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div className="ssf-foot">
          <div className="ssf-foot-left">
            {/* Only show Back when there's somewhere to go back TO — i.e.
                a standalone launch that started at step 1. The Stage 3
                launch has no step 1 to return to. */}
            {step === 2 && !launchedFromStage3 && (
              <button type="button" className="ssf-btn ssf-btn-ghost" onClick={() => setStep(1)} disabled={sending}>← Back</button>
            )}
          </div>
          <div className="ssf-foot-right">
            <button type="button" className="ssf-btn ssf-btn-ghost" onClick={onClose} disabled={sending}>Cancel</button>
            {step === 1 && (
              <button type="button" className="ssf-btn ssf-btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>
                Next: Preview →
              </button>
            )}
            {step === 2 && (
              <button type="button" className="ssf-btn ssf-btn-primary" disabled={sending} onClick={send}>
                {sending ? 'Sending…' : `Send for Signature (${selectedDocs.length})`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Find the controller-embedded «CBC-SIG-{PARTY}-9417» marker in the
 * preview PDF and convert its position into Zoho-style (top-left origin,
 * page 0-based) coordinates that we can drop straight into DocSettings.
 *
 * PDF.js exposes text items with a `transform` matrix; the last two
 * entries are the baseline (x, y) in PDF user-space (bottom-left origin),
 * so we mirror Y to match Zoho's top-left convention. The token may
 * appear split across multiple text items (DomPDF sometimes breaks runs
 * at style boundaries) — we therefore concatenate items in reading
 * order and search the joined string, then trace the match back to the
 * item that anchors its start.
 *
 * Returns null when the marker can't be found on any page; callers fall
 * back to the hard-coded DEFAULTS in that case.
 */
async function detectSignatureMarker(
  blob: Blob,
  party: 'customer' | 'consignee' | 'supplier',
  onPageCount?: (n: number) => void,
): Promise<Partial<DocSettings> | null> {
  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  onPageCount?.(pdf.numPages);

  // Visual sig-box scaffold: 220×80 CSS px ≈ 165×60 pt (DomPDF 96 dpi → PDF
  // 72 pt/in conversion = 0.75). Field is sized to match the box so Zoho's
  // signature widget visually replaces the placeholder when the customer
  // signs. Adjustable per-send via drag/resize.
  const BOX_WIDTH_PT  = 165;
  const BOX_HEIGHT_PT = 60;
  // Distance from the marker's text BASELINE to the sig-box's TOP edge.
  // The placeholder div has padding: 32px 0 (= 24pt top), and the body
  // text baseline sits ~10pt below the top of the line at our 12pt /
  // 1.55-line-height defaults — so baseline ≈ box_top + 34pt. PDF.js
  // hands us the baseline; Zoho wants the field's top, so we subtract
  // this offset. A few pt of slop here doesn't matter — the user can
  // drag-adjust on the preview and the dragged value sticks.
  const BASELINE_TO_BOX_TOP_PT = 34;

  try {
    for (let pageIdx = 1; pageIdx <= pdf.numPages; pageIdx++) {
      const page = await pdf.getPage(pageIdx);
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;

      const content = await page.getTextContent();
      // Build a flat string and a parallel array of (charIndex → item) so
      // we can resolve a regex hit back to a positioned text item.
      let joined = '';
      const charToItem: number[] = [];
      const items = content.items as Array<{ str: string; transform: number[] }>;
      items.forEach((it, idx) => {
        joined += it.str;
        for (let i = 0; i < it.str.length; i++) charToItem.push(idx);
      });

      const re = new RegExp(`«CBC-SIG-${party.toUpperCase()}-9417»`, 'i');
      const m = re.exec(joined);
      if (!m || m.index == null) continue;

      const hitItem = items[charToItem[m.index]];
      if (!hitItem) continue;

      // transform = [a, b, c, d, e, f] where (e, f) is the baseline
      // origin in PDF user-space (bottom-left origin).
      const xBaseline = hitItem.transform[4];
      const yBaseline = hitItem.transform[5];

      // PDF.js → Zoho (top-left origin):
      //   baseline-from-top = pageHeight − baselineInPdfCoords
      //   box-top-from-top   = baseline-from-top − BASELINE_TO_BOX_TOP_PT
      const baselineFromTop = pageHeight - yBaseline;
      const yZoho           = Math.max(0, baselineFromTop - BASELINE_TO_BOX_TOP_PT);

      return {
        page:   pageIdx - 1,
        x:      Math.max(0, xBaseline),
        y:      yZoho,
        width:  BOX_WIDTH_PT,
        height: BOX_HEIGHT_PT,
      };
    }
  } finally {
    pdf.destroy();
  }
  return null;
}

const SSF_CSS = `
.ssf-overlay {
  position: fixed; inset: 0; z-index: 260000;
  background: rgba(7, 30, 50, .55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  animation: ssfFade .18s ease both;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
@keyframes ssfFade { from { opacity: 0 } to { opacity: 1 } }

.ssf-shell {
  width: 100%; max-width: 1200px; height: calc(100vh - 36px);
  display: flex; flex-direction: column;
  border-radius: 18px; overflow: hidden;
  background: #fff;
  box-shadow: 0 28px 70px rgba(15, 23, 42, .50), 0 0 0 1px rgba(99, 102, 241, .15);
}

.ssf-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px;
  background: linear-gradient(110deg, #4338ca 0%, #6366f1 60%, #8b5cf6 100%);
  color: #fff;
  flex-shrink: 0;
}
.ssf-head-left { display: inline-flex; align-items: center; gap: 14px; min-width: 0; }
.ssf-head-ico {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
}
.ssf-head-label { font-size: 10px; font-weight: 800; letter-spacing: .14em; color: rgba(255,255,255,.78); }
.ssf-head-title { font-size: 17px; font-weight: 800; letter-spacing: -.01em; margin-top: 2px; }
.ssf-head-sub   { font-size: 11px; color: rgba(255,255,255,.78); margin-top: 1px; }
.ssf-close {
  width: 34px; height: 34px; border-radius: 9px;
  background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.22);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.ssf-close:hover { background: rgba(255,255,255,.26); transform: rotate(90deg); }

.ssf-steps {
  display: flex; align-items: center; gap: 0;
  padding: 12px 22px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.ssf-step {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  font-size: 12.5px; font-weight: 600; color: #94a3b8;
}
.ssf-step:not(:last-child)::after {
  content: ''; display: inline-block; width: 60px; height: 1px;
  background: #cbd5e1; margin-left: 4px;
}
.ssf-step.is-active { color: #4338ca; }
.ssf-step.is-done   { color: #16a34a; }
.ssf-step-num {
  width: 22px; height: 22px; border-radius: 50%;
  background: #e2e8f0; color: #475569;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800;
}
.ssf-step.is-active .ssf-step-num { background: #4338ca; color: #fff; }
.ssf-step.is-done   .ssf-step-num { background: #16a34a; color: #fff; }

.ssf-body { flex: 1; min-height: 0; overflow: hidden; display: flex; }
.ssf-step1 {
  flex: 1; overflow-y: auto; padding: 18px 22px;
  display: flex; flex-direction: column; gap: 18px;
  background: #fafbff;
}
.ssf-step2 {
  flex: 1; min-height: 0; display: grid;
  grid-template-columns: 220px 1fr 280px;
  background: #f1f5f9;
}

.ssf-block {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 1px 2px rgba(15,23,42,.04);
}
.ssf-block-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ssf-block-title { font-size: 14px; font-weight: 800; color: #0f172a; }
.ssf-block-sub   { font-size: 12px; color: #64748b; margin-top: 2px; }
.ssf-counter {
  background: #eef2ff; color: #4338ca; padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}

.ssf-doc-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.ssf-doc-card {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; background: #fff;
  cursor: pointer; transition: all .15s ease;
}
.ssf-doc-card:hover { border-color: #cbd5e1; }
.ssf-doc-card.is-checked { border-color: #4338ca; background: linear-gradient(180deg, #fff 0%, #eef2ff 100%); }
.ssf-doc-card input { margin-top: 3px; accent-color: #4338ca; }
.ssf-doc-card-body { min-width: 0; flex: 1; }
.ssf-doc-card-code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10.5px; font-weight: 800; color: #4338ca; letter-spacing: .04em; }
.ssf-doc-card-title { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 2px; line-height: 1.35; }
.ssf-doc-card-meta { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.ssf-chip { background: #ecfeff; color: #0e7490; padding: 2px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 600; }
.ssf-chip-muted { background: #f1f5f9; color: #64748b; }

.ssf-loading, .ssf-empty {
  padding: 22px; text-align: center; color: #64748b; font-size: 13px;
  background: #f8fafc; border-radius: 10px; border: 1px dashed #cbd5e1;
}

.ssf-add-btn {
  background: #eef2ff; border: 1px solid #c7d2fe; color: #4338ca;
  padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.ssf-add-btn:disabled { opacity: .5; cursor: not-allowed; }

.ssf-signers { display: flex; flex-direction: column; gap: 8px; }
.ssf-signer-row {
  display: grid; grid-template-columns: 32px 1fr 1fr 30px; gap: 8px; align-items: center;
}
.ssf-signer-order {
  width: 28px; height: 28px; border-radius: 8px;
  background: #4338ca; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
}
.ssf-signer-row input {
  height: 36px; padding: 0 10px;
  border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff;
  font-size: 13px; color: #0f172a;
}
.ssf-signer-row input:focus { border-color: #4338ca; outline: none; box-shadow: 0 0 0 3px rgba(67,56,202,.12); }
.ssf-signer-remove {
  width: 30px; height: 30px; border-radius: 8px;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}

.ssf-options { margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e2e8f0; display: flex; flex-direction: column; gap: 10px; }
.ssf-checkbox { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; cursor: pointer; }
.ssf-checkbox input { accent-color: #4338ca; }
.ssf-inline label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #334155; }
.ssf-inline input {
  height: 32px; width: 80px; padding: 0 10px;
  border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff;
  font-size: 13px;
}
.ssf-notes-label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: #475569; }
.ssf-notes-label textarea {
  border: 1.5px solid #e2e8f0; border-radius: 8px; background: #fff;
  padding: 8px 10px; font: inherit; font-size: 13px; color: #0f172a; resize: vertical;
}

/* Step 2 */
.ssf-doc-rail { background: #fff; border-right: 1px solid #e2e8f0; padding: 14px 10px; overflow-y: auto; }
.ssf-rail-head { font-size: 10.5px; font-weight: 800; color: #64748b; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 8px; padding: 0 4px; }
.ssf-rail-item {
  width: 100%; text-align: left;
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px; border-radius: 9px;
  background: transparent; border: 1.5px solid transparent; color: #475569;
  cursor: pointer; transition: all .15s ease;
  margin-bottom: 6px;
}
.ssf-rail-item:hover { background: #f1f5f9; }
.ssf-rail-item.is-active { background: #eef2ff; border-color: #c7d2fe; }
.ssf-rail-code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10.5px; font-weight: 800; color: #4338ca; }
.ssf-rail-name { font-size: 12.5px; font-weight: 600; color: #0f172a; line-height: 1.3; }

/* align-items: flex-start pins the PDF wrapper to the TOP of the pane.
 * Otherwise on lower-zoom screens (<=100%) the wrapper grows taller
 * than the pane and align-items: center clips both ends, hiding the
 * PDF's header (logo + barcode) behind the modal's purple title bar.
 * With flex-start + overflow-y: auto the user can scroll the wrapper
 * vertically to see the bottom of the page. */
.ssf-preview-pane { background: #cbd5e1; display: flex; align-items: flex-start; justify-content: center; padding: 16px; overflow-y: auto; }
/* Wrapper sized to A4 aspect ratio so the px↔pt conversion is uniform
 * on both axes — letting the drag handler compute PDF coords without
 * having to track horizontal/vertical scale factors separately. */
.ssf-preview-wrap {
  position: relative;
  width: 100%; max-width: 560px;
  aspect-ratio: 595 / 842;
  background: #fff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, .25);
  border-radius: 4px;
  overflow: hidden;
  user-select: none;
}
.ssf-preview-frame { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
.ssf-preview-state { color: #475569; font-size: 13px; padding: 32px; }

/* Draggable signature box overlaid on the PDF preview. The corner
 * handle is a child so its own pointerdown can be distinguished from
 * the parent's "move" pointerdown — picking up the corner resizes,
 * picking up anywhere else moves. */
.ssf-sig-overlay {
  position: absolute;
  z-index: 10;
  background: rgba(99, 102, 241, .22);
  border: 2px dashed #4338ca;
  border-radius: 4px;
  cursor: move;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(67, 56, 202, .25);
  touch-action: none;
}
.ssf-sig-label {
  color: #4338ca; font-size: 11px; font-weight: 800;
  text-shadow: 0 1px 0 rgba(255,255,255,.8);
  letter-spacing: .04em; text-transform: uppercase;
  pointer-events: none;
}
.ssf-sig-page {
  position: absolute; top: 2px; left: 4px;
  font-size: 9px; color: #4338ca; opacity: .8; font-weight: 700;
  pointer-events: none;
}
.ssf-sig-resize {
  position: absolute; right: -1px; bottom: -1px;
  width: 14px; height: 14px;
  background: #4338ca; border: 2px solid #fff;
  border-radius: 3px;
  cursor: nwse-resize;
  touch-action: none;
}

.ssf-coord-pane { background: #fff; border-left: 1px solid #e2e8f0; padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.ssf-coord-help { font-size: 11.5px; color: #64748b; line-height: 1.45; }
.ssf-coord-help code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 10.5px; color: #4338ca; }

/* Recipient mini-card at the bottom of the coord pane — replaces the
 * separate Review step by showing the destination right next to the
 * Send button. */
.ssf-recipient-card {
  margin-top: 10px; padding: 10px 12px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
}
.ssf-recipient-h { font-size: 9.5px; font-weight: 800; color: #64748b; letter-spacing: .14em; text-transform: uppercase; }
.ssf-recipient-name { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 4px; }
.ssf-recipient-email { font-size: 11.5px; color: #64748b; margin-top: 2px; word-break: break-all; }

.ssf-coord-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; color: #334155; }
.ssf-coord-row span { font-weight: 600; min-width: 60px; }
.ssf-coord-row input {
  width: 90px; height: 30px; padding: 0 8px;
  border: 1.5px solid #e2e8f0; border-radius: 7px; background: #fff;
  font-size: 12.5px; color: #0f172a; text-align: right;
}
.ssf-coord-row input:focus { border-color: #4338ca; outline: none; box-shadow: 0 0 0 3px rgba(67,56,202,.12); }
.ssf-reset-btn {
  margin-top: 6px;
  background: #f8fafc; border: 1px solid #cbd5e1; color: #475569;
  padding: 6px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 600; cursor: pointer;
}

/* Footer */
.ssf-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 22px;
  background: #fff; border-top: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.ssf-foot-right { display: inline-flex; gap: 10px; }
.ssf-btn {
  padding: 9px 18px; border-radius: 9px; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all .15s ease; border: 1.5px solid transparent;
}
.ssf-btn-ghost { background: #fff; border-color: #cbd5e1; color: #334155; }
.ssf-btn-ghost:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.ssf-btn-primary { background: linear-gradient(110deg, #4338ca 0%, #6366f1 100%); color: #fff; }
.ssf-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(67,56,202,.30); }
.ssf-btn:disabled { opacity: .5; cursor: not-allowed; }

@media (max-width: 980px) {
  .ssf-step2 { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
  .ssf-doc-rail, .ssf-coord-pane { border: 0; border-bottom: 1px solid #e2e8f0; }
  .ssf-doc-grid { grid-template-columns: 1fr; }
}

[data-bs-theme="dark"] .ssf-shell { background: #0f172a; }
[data-bs-theme="dark"] .ssf-steps { background: #0b1220; border-bottom-color: #1e293b; }
[data-bs-theme="dark"] .ssf-step1 { background: #0b1220; }
[data-bs-theme="dark"] .ssf-step2 { background: #0b1220; }
[data-bs-theme="dark"] .ssf-block { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .ssf-block-title { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-block-sub { color: #94a3b8; }
[data-bs-theme="dark"] .ssf-doc-card { background: #0f172a; border-color: #334155; }
[data-bs-theme="dark"] .ssf-doc-card.is-checked { background: linear-gradient(180deg, #0f172a 0%, rgba(99,102,241,.18) 100%); border-color: #6366f1; }
[data-bs-theme="dark"] .ssf-doc-card-title { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-signer-row input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-doc-rail, [data-bs-theme="dark"] .ssf-coord-pane { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .ssf-rail-name { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-rail-item:hover { background: rgba(99,102,241,.10); }
[data-bs-theme="dark"] .ssf-rail-item.is-active { background: rgba(99,102,241,.18); border-color: #6366f1; }
[data-bs-theme="dark"] .ssf-coord-row input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-recipient-card { background: rgba(99,102,241,.10); border-color: #334155; }
[data-bs-theme="dark"] .ssf-recipient-name { color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-foot { background: #0b1220; border-top-color: #1e293b; }
[data-bs-theme="dark"] .ssf-btn-ghost { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .ssf-loading, [data-bs-theme="dark"] .ssf-empty { background: #0f172a; border-color: #334155; color: #94a3b8; }
`;
