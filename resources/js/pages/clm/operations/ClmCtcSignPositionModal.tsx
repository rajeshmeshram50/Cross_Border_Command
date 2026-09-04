import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
// Vite-friendly worker URL — bundles pdfjs's worker as a separate chunk
// so it runs off the main thread.
// @ts-ignore — Vite's ?worker&url import handled at build time
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import type { OpsTokens } from './useOpsTheme';
import type { HeaderConfig, FooterConfig } from '../../hrms/doc-templates/HeaderFooterPanel';

// One-time pdfjs worker setup at module scope.
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker as unknown as string;

/* ─────────────────────────────────────────────────────────────────────────
 * CTC → Send for Signature & Negotiation · Step 2 (position signatures).
 *
 * Reuses the same Zoho Sign coordinate model as the sales signature modal:
 * the preview PDF is painted onto a <canvas> via pdf.js at the wrapper's
 * exact width, and one draggable box per signer is overlaid in the SAME
 * coordinate space. Rendering to canvas (rather than an <iframe>) keeps the
 * page edge-to-edge with the wrapper so the box lands where it's dragged.
 * Boxes are stored in PDF points (A4 595×842, top-left origin) — exactly
 * what Zoho's submit field-placement expects. On send it POSTs to
 * /clm/signature-requests/ctc-send.
 * ───────────────────────────────────────────────────────────────────────── */

const A4_W = 595;
const A4_H = 842;
type Box = { x: number; y: number; page: number; width: number; height: number };
type Signer = { name: string; email: string };

const SIG_GRADS = ['#4C1D95,#7C3AED', '#0e7490,#0891b2', '#047857,#059669', '#B45309,#D97706', '#9D174D,#DB2777'];
/* Signature boxes ONE signer may be given on this contract are DELIBERATELY
 * uncapped - BR-04 of the Multiple Signature Placements spec: there must be
 * no maximum limit on the number of placements per contact person. A long
 * agreement is initialled on every page, at the execution block, and on each
 * annexure and schedule, so any fixed ceiling becomes the limitation.
 * ZohoSignService::submitWithFields emits one Signature field per entry and
 * has no ceiling of its own, so nothing downstream needs a bound either.
 * Do not reintroduce a cap here without the spec changing first. */

export default function ClmCtcSignPositionModal({ t, contractId, code, title, signers, header, footer, content, onClose, onSent }: {
  t: OpsTokens; contractId: number; code: string; title: string; signers: Signer[];
  header: HeaderConfig; footer: FooterConfig; content: string;
  onClose: () => void; onSent: () => void;
}) {
  const toast = useToast();
  // Stable per-signer key so each signer's field lands at its own coords.
  const keyed = signers.map((s, i) => ({ ...s, key: `signer${i + 1}` }));
  const seed = (i: number): Box => ({ x: 60 + (i % 3) * 170, y: 720 - Math.floor(i / 3) * 70, page: 0, width: 150, height: 45 });

  /* Each signer owns a LIST of boxes — Legal Team #9: one counterparty must be
   * able to sign the same document in more than one place. The list travels as
   * document_settings[contractId][signerKey].boxes and ZohoSignService drops one
   * Signature field per entry. A one-entry list serialises to exactly the old
   * single-box payload, so nothing changes until a box is actually added. */
  const [boxes, setBoxes] = useState<Record<string, Box[]>>(() => Object.fromEntries(keyed.map((s, i) => [s.key, [seed(i)]])));
  const [activeKey, setActiveKey] = useState<string>(keyed[0]?.key ?? '');
  /* Which of the active signer's boxes the drag overlay and coord pane drive. */
  const [activeBoxIdx, setActiveBoxIdx] = useState(0);
  /* The page shown on the canvas — deliberately SEPARATE from the active box's
     page. Prev/Next used to patch the active box's `page`, so paging through
     the contract physically dragged that signature box along with the view and
     relabelled its chip p1 → p2 → p3 …, which made it look like the box was
     landing everywhere. A box now moves only when you drag it or type in the
     Page field; paging just looks. */
  const [viewPage, setViewPage] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  // Zoho Sign validity — fixed at 30 days. No setter: the field is read-only,
  // and this is the ONLY signing window in the flow (the earlier Send-for-Signing
  // popup's stepper was removed because its value was never used).
  const [expiryDays] = useState(30);
  const [notes, setNotes] = useState('Please review and sign this agreement.');
  const [wrapW, setWrapW] = useState(0);
  // Page count of the preview PDF + a flag that flips once the blob has
  // been parsed into a pdf.js document and is ready to paint to canvas.
  const [pageCount, setPageCount] = useState(1);
  const [pdfReady, setPdfReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; init: Box } | null>(null);
  // Canvas-rendered preview (replaces the old <iframe> native PDF viewer).
  // Painting the page bitmap at exactly the wrapper width keeps the page
  // edge-to-edge with the wrapper, so the drag overlay's px↔pt conversion
  // (wrapW / A4_W) maps 1:1 onto the PDF and the signature box lands where
  // it's dragged. The iframe let the browser's PDF viewer add its own
  // page-fit padding, which offset the box.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  const activeList = boxes[activeKey] ?? [];
  const active = activeList[Math.min(activeBoxIdx, Math.max(0, activeList.length - 1))];

  // Local string state for the "Page" input so it can be CLEARED (backspaced to
  // empty) and freely retyped — the old `value={active.page + 1}` with a
  // `Number(x) || 1` fallback snapped an empty field back to 1, so you could
  // never clear it or jump to page 6 (CBC-576). The page only commits on a
  // valid in-range number; on blur / signer-switch it resyncs to the real page.
  const [pageInput, setPageInput] = useState('1');
  useEffect(() => { setPageInput(String((active?.page ?? 0) + 1)); }, [active?.page, activeKey, activeBoxIdx]);

  // Load the contract preview PDF (page-shell + org signature applied)
  // and parse it into a pdf.js document for the canvas renderer.
  useEffect(() => {
    let alive = true;
    setLoading(true); setPreviewUrl(null); setPdfReady(false);
    api.post('/clm/signature-requests/ctc-preview', { contract_id: contractId, header_config_override: header, footer_config_override: footer, content_override: content }, { responseType: 'blob' })
      .then(async r => {
        if (!alive) return;
        const blob = r.data as Blob;
        setPreviewUrl(URL.createObjectURL(blob));
        try {
          const buf = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          if (!alive) { pdf.destroy(); return; }
          try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
          pdfDocRef.current = pdf;
          setPageCount(Math.max(1, pdf.numPages));
          setPdfReady(true);
        } catch {
          // Parse failed — preview pane keeps showing its loading state.
        }
      })
      .catch(() => { if (alive) toast.error('Preview failed', 'Could not render the contract for signing.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Tear down the pdf.js document + any in-flight render on unmount.
  useEffect(() => () => {
    try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
    try { pdfDocRef.current?.destroy(); } catch { /* ignore */ }
    pdfDocRef.current = null;
  }, []);

  /* Paint the active page onto the <canvas> at the wrapper's width.
   * Re-runs when the page changes, the doc loads, or the wrapper resizes. */
  useEffect(() => {
    if (!pdfReady) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const doc = pdfDocRef.current;
    if (!canvas || !wrap || !doc) return;
    const cssWidth = wrap.clientWidth || wrapW;
    if (cssWidth <= 0) return;
    let cancelled = false;
    (async () => {
      try {
        const pageNum = Math.min(doc.numPages, Math.max(1, viewPage + 1));
        const page = await doc.getPage(pageNum);
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
  }, [pdfReady, viewPage, wrapW]);

  // Measure the preview wrapper so px↔pt conversion stays accurate.
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(es => { for (const e of es) setWrapW(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewUrl]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const setActive = (patch: Partial<Box>) => setBoxes(b => {
    const arr = (b[activeKey] ?? []).slice();
    if (!arr.length) return b;
    const idx = Math.min(activeBoxIdx, arr.length - 1);
    arr[idx] = { ...arr[idx], ...patch };
    return { ...b, [activeKey]: arr };
  });

  /* Add / remove a signature box for the ACTIVE signer. */
  const addBox = () => setBoxes(b => {
    const arr = (b[activeKey] ?? []).slice();
    const last = arr[arr.length - 1] ?? seed(0);
    const { width, height } = last;
    /* The new box lands on the page you are LOOKING at, not on whatever page
       the previous box happens to sit on. Signing only ever started on page 1
       and every box after it inherited that page, so putting a signature on
       page 2 or the last page meant adding it, then hunting for the Page
       field to move it — the whole complaint. */
    const onPage = arr.filter(x => (x.page ?? 0) === viewPage).length;
    /* Cascade UP from the signature strip so boxes never land on top of each
       other (identical coords leave the lower one impossible to grab), and
       start a fresh column to the right once one runs off the top of the
       sheet — otherwise every further box clamps onto y=0 and stacks there. */
    const perCol = Math.max(1, Math.floor(680 / 70) + 1);
    arr.push({
      ...last,
      page: viewPage,
      x: clamp(60 + Math.floor(onPage / perCol) * (width + 20), 0, A4_W - width),
      y: clamp(720 - (onPage % perCol) * 70, 0, A4_H - height),
    });
    setActiveBoxIdx(arr.length - 1);
    return { ...b, [activeKey]: arr };
  });
  /* A signer's LAST box can be removed too. Every signer is seeded with a box
     on page 1, so a three-party contract puts three boxes on the cover even
     when only one party signs there; without this the extras could only be
     moved, never cleared, and there was no way to say "this party does not
     sign on page 1". Sending with a signer left at zero boxes is blocked in
     send() instead, so the flexibility cannot produce a Zoho recipient with
     nothing to sign. */
  const removeBox = (idx: number) => setBoxes(b => {
    const arr = (b[activeKey] ?? []).slice();
    arr.splice(idx, 1);
    setActiveBoxIdx(i => Math.max(0, Math.min(i, arr.length - 1)));
    return { ...b, [activeKey]: arr };
  });
  /* Switching signer selects that signer and NOTHING else - the page you are
     looking at stays put. Jumping the canvas to the signer's first box read
     well in isolation but broke the ordinary job: standing on page 3 and
     giving all three parties a box there. Every click on a name yanked the
     view back to page 1, so the second and third box could never be placed.
     To go to a specific box, click its chip (Sign 2 p3) - that is explicit. */
  const selectSigner = (key: string) => { setActiveKey(key); setActiveBoxIdx(0); };

  const onDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!active) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, init: { ...active } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current; if (!d || wrapW <= 0) return;
    const ptPerPx = A4_W / wrapW;
    const dx = (e.clientX - d.sx) * ptPerPx, dy = (e.clientY - d.sy) * ptPerPx;
    if (d.mode === 'move') setActive({ x: clamp(d.init.x + dx, 0, A4_W - d.init.width), y: clamp(d.init.y + dy, 0, A4_H - d.init.height) });
    else setActive({ width: clamp(d.init.width + dx, 40, A4_W - d.init.x), height: clamp(d.init.height + dy, 24, A4_H - d.init.y) });
  };
  const onUp = () => { dragRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };

  const send = async () => {
    /* Second line of defence behind the disabled button. A double Zoho request
       is not a harmless retry — it raises TWO signature requests against the
       same contract, so the counterparty gets two mails and the second reply
       lands on a request nobody is tracking. The button being disabled already
       stops the ordinary double-click; this catches the paths that skip it. */
    if (sending || loading) return;
    /* Every counterparty on the document must sign SOMEWHERE (BR-09: a
       counterparty is complete only when all its placements are done, which
       cannot happen if it has none). Boxes are freely removable so a party
       can be cleared off page 1, so this is where that freedom is bounded -
       naming the signer, because with several parties it is not obvious
       which one was left empty. */
    const empty = keyed.filter(k => !(boxes[k.key] ?? []).length);
    if (empty.length) {
      toast.error(
        empty.length === 1 ? 'No signature box' : 'Signers without a signature box',
        `${empty.map(k => k.name || k.email).join(', ')} ${empty.length === 1 ? 'has' : 'have'} no signature box. Add at least one place for each signer before sending.`,
      );
      return;
    }
    setSending(true);
    try {
      const payload = {
        contract_id: contractId,
        signers: keyed.map((s, i) => ({ name: s.name, email: s.email, role: s.key, order: i + 1 })),
        /* One entry per signer. `boxes` carries EVERY position that signer must
           sign at; the flat x/y/width/height on the same object stays as the
           first box so the single-box fallback in ZohoSignService (and any
           consumer reading the flat shape) keeps working unchanged. */
        document_settings: {
          [contractId]: Object.fromEntries(keyed.map((s, i) => {
            const list = boxes[s.key] ?? [seed(i)];
            return [s.key, { ...(list[0] ?? seed(i)), boxes: list }];
          })),
        },
        expiry_days: expiryDays,
        is_sequential: false,
        notes,
        header_config_override: header,
        footer_config_override: footer,
        content_override: content,
      };
      const res = await api.post('/clm/signature-requests/ctc-send', payload);
      const msg = res.data?.message ?? 'Sent for signature.';
      toast.success('Sent for signing', msg);
      onSent();
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not send', m || 'Failed to send for signature.');
    } finally { setSending(false); }
  };

  const pxPerPt = wrapW > 0 ? wrapW / A4_W : 0;
  const ipt: React.CSSProperties = { width: '100%', height: 30, padding: '0 9px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 8, fontSize: 11, fontFamily: 'inherit', color: t.text, outline: 'none', background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', boxSizing: 'border-box' };
  const navBtn = (disabled: boolean): React.CSSProperties => ({ border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.12)' : '#fff', color: t.dark ? '#c4b5fd' : '#6D28D9', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, fontFamily: 'inherit' });

  return createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 999999999, background: 'rgba(15,7,50,.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-sans)' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(1080px,97vw)', height: 'min(88vh,820px)', background: t.surface, borderRadius: 18, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}`, boxShadow: '0 40px 90px rgba(109,40,217,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: '14px 20px', background: 'linear-gradient(120deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></div>
            <div><div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Position Signatures · {code}</div><div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{title || 'Agreement'}</div><div style={{ fontSize: 9, color: 'rgba(255,255,255,.72)', marginTop: 1 }}>Drag each signer's box to set where they sign · sent via Zoho Sign</div></div>
          </div>
          <button onClick={() => !sending && onClose()} disabled={sending} style={{ width: 30, height: 30, borderRadius: 9, border: 'none', background: 'rgba(255,255,255,.18)', cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {/* body: preview (left) + controls (right)
            Frozen once "Send for Signature" is pressed. The request travels to
            Zoho and takes a few seconds; until it lands the whole body stayed
            live, so a signature box could still be dragged, the page flipped or
            an expiry/notes field retyped — none of which reaches the payload
            that was already posted, leaving the screen disagreeing with what
            was sent. `inert` (React 19) blocks mouse, keyboard and focus across
            the subtree in one attribute; the dim + wait cursor say why. */}
        <div
          inert={sending}
          style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', ...(sending ? { opacity: 0.55, cursor: 'wait' } : null) }}
        >
          {/* preview */}
          <div style={{ flex: 1, minWidth: 0, background: t.dark ? '#100c1c' : '#EDEAF6', padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {/* Prev / Next page navigation — parity with the sales/PI
                signature modals. Moves the active signer's box (and the
                canvas, which follows viewPage) without moving any box. Hidden on
                single-page contracts. */}
            {pageCount > 1 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <button type="button" onClick={() => setViewPage(p => Math.max(0, p - 1))} disabled={viewPage <= 0} style={navBtn(viewPage <= 0)} aria-label="Previous page">‹ Prev</button>
                <span style={{ fontSize: 11, fontWeight: 800, color: t.textMuted, minWidth: 92, textAlign: 'center' }}>Page {viewPage + 1} of {pageCount}</span>
                <button type="button" onClick={() => setViewPage(p => Math.min(pageCount - 1, p + 1))} disabled={viewPage >= pageCount - 1} style={navBtn(viewPage >= pageCount - 1)} aria-label="Next page">Next ›</button>
              </div>
            )}
            <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 560, aspectRatio: `${A4_W} / ${A4_H}`, background: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,.25)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
              {(loading || !pdfReady) && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#64748B', zIndex: 5 }}>Rendering preview…</div>}
              {/* pdf.js paints the active page onto this canvas at the
                  wrapper's exact width (see the canvas render effect), so the
                  page fills the wrapper edge-to-edge and the draggable signer
                  boxes line up with the PDF. The old <iframe> deferred to the
                  browser's native PDF viewer, whose page-fit padding offset
                  the boxes. */}
              <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block', background: '#fff' }} />
              {/* signer overlays on the active page */}
              {pxPerPt > 0 && keyed.map((s, i) => {
                const grad = SIG_GRADS[i % SIG_GRADS.length];
                const list = boxes[s.key] ?? [];
                // A signer can have several boxes, each on its own page — only
                // the ones sitting on the page being previewed are drawn.
                return list.map((b, bi) => {
                  if (!b || b.page !== viewPage) return null;
                  const on = s.key === activeKey && bi === activeBoxIdx;
                  return (
                    <div key={`${s.key}:${bi}`} onPointerDown={e => { if (!on) { e.stopPropagation(); setActiveKey(s.key); setActiveBoxIdx(bi); return; } onDown(e, 'move'); }}
                      style={{ position: 'absolute', left: b.x * pxPerPt, top: b.y * pxPerPt, width: b.width * pxPerPt, height: b.height * pxPerPt, border: `2px ${on ? 'solid' : 'dashed'} ${on ? '#7C3AED' : 'rgba(124,58,237,.45)'}`, borderRadius: 5, background: on ? 'rgba(124,58,237,.14)' : 'rgba(124,58,237,.05)', cursor: on ? 'move' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', touchAction: 'none', opacity: on ? 1 : 0.65 }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: '#6D28D9', background: `linear-gradient(135deg,${grad})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '90%' }}>✒ {s.name || `Signer ${i + 1}`}{list.length > 1 ? ` · ${bi + 1}` : ''}</span>
                      {on && <div onPointerDown={e => onDown(e, 'resize')} style={{ position: 'absolute', right: -5, bottom: -5, width: 12, height: 12, borderRadius: 3, background: '#7C3AED', border: '1.5px solid #fff', cursor: 'nwse-resize', touchAction: 'none' }} />}
                    </div>
                  );
                });
              })}
            </div>
          </div>
          {/* controls */}
          <div style={{ width: 300, flexShrink: 0, borderLeft: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.surface, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '14px 16px', gap: 12 }}>
            <div>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#a78bfa' : '#6D28D9', marginBottom: 7 }}>Signers ({keyed.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {keyed.map((s, i) => {
                  const on = s.key === activeKey; const grad = SIG_GRADS[i % SIG_GRADS.length];
                  return (
                    <button key={s.key} onClick={() => selectSigner(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9, border: `1.5px solid ${on ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE')}`, background: on ? (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF') : t.surface, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <div style={{ width: 26, height: 26, borderRadius: 8, background: `linear-gradient(135deg,${grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>{(s.name || `S${i + 1}`).slice(0, 2).toUpperCase()}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 10, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || `Signer ${i + 1}`}</div><div style={{ fontSize: 8, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.email}</div></div>
                      {/* How many places this signer signs in — only worth
                          showing once it is more than the usual one. */}
                      {((boxes[s.key]?.length ?? 1) > 1 || (boxes[s.key]?.length ?? 1) === 0) && (
                        <span style={{ flexShrink: 0, padding: '2px 6px', borderRadius: 20, background: (boxes[s.key]?.length ?? 0) === 0 ? 'linear-gradient(135deg,#DC2626,#B91C1C)' : `linear-gradient(135deg,${grad})`, fontSize: 7.5, fontWeight: 800, color: '#fff' }}>{(boxes[s.key]?.length ?? 0) === 0 ? 'No box' : `${boxes[s.key]!.length}×`}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Signature boxes for the ACTIVE signer — Legal Team #9: one
                counterparty may have to sign the same contract in several
                places. Each box positions independently via the drag overlay
                and the coordinate pane below, and may sit on its own page. */}
            {/* Always rendered, even when this signer has NO box left: the panel
                carries the only "+ Add box" button, so guarding it on `active`
                meant clearing a signer off page 1 removed the very control
                needed to place them on page 2. The coordinate pane below still
                needs an active box and keeps its guard. */}
            {(
              <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', padding: '10px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.textMuted }}>Signature Boxes</span>
                  <span style={{ fontSize: 8, fontWeight: 800, color: t.dark ? '#a78bfa' : '#6D28D9' }}>{activeList.length}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {activeList.map((b, bi) => {
                    const on = bi === activeBoxIdx;
                    return (
                      <span key={bi} onClick={() => { setActiveBoxIdx(bi); setViewPage(b.page ?? 0); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 8, cursor: 'pointer', border: `1.5px solid ${on ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.22)' : '#EDE9FE')}`, background: on ? (t.dark ? 'rgba(124,58,237,.16)' : '#F5F0FF') : 'transparent', fontSize: 9, fontWeight: 800, color: on ? (t.dark ? '#c4b5fd' : '#6D28D9') : t.textMuted }}>
                        Sign {bi + 1}
                        <span style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted }}>p{(b.page ?? 0) + 1}</span>
                        {(
                          <button type="button" aria-label={`Remove signature box ${bi + 1}`} onClick={e => { e.stopPropagation(); removeBox(bi); }} style={{ border: 'none', background: 'transparent', padding: 0, lineHeight: 1, cursor: 'pointer', color: t.textMuted, fontSize: 11, fontWeight: 800 }}>×</button>
                        )}
                      </span>
                    );
                  })}
                  {(
                    <button type="button" onClick={addBox} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, cursor: 'pointer', border: `1.5px dashed ${t.dark ? 'rgba(124,58,237,.45)' : '#C4B5FD'}`, background: 'transparent', fontSize: 9, fontWeight: 800, color: t.dark ? '#a78bfa' : '#6D28D9', fontFamily: 'inherit' }}>+ Add box</button>
                  )}
                </div>
                <div style={{ fontSize: 7.5, color: t.textMuted, marginTop: 7, lineHeight: 1.5 }}>
                  {activeList.length === 0 ? `${(keyed.find(k => k.key === activeKey)?.name) || 'This signer'} has no signature box — add at least one place, or they cannot sign.` : `${(keyed.find(k => k.key === activeKey)?.name) || 'This signer'} signs in ${activeList.length} place${activeList.length > 1 ? 's' : ''} on this contract.`}
                </div>
              </div>
            )}
            {/* coord pane for active signer */}
            {active && (
              <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', padding: '10px 11px' }}>
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 8 }}>Signature Position</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([['X', 'x', A4_W], ['Y', 'y', A4_H], ['Width', 'width', A4_W], ['Height', 'height', A4_H]] as const).map(([lbl, k, max]) => (
                    <div key={k}><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>{lbl}</div><input type="number" value={Math.round(active[k])} onChange={e => setActive({ [k]: clamp(Number(e.target.value) || 0, 0, max) } as Partial<Box>)} style={ipt} /></div>
                  ))}
                  <div><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Page</div><input type="number" min={1} max={pageCount} value={pageInput} onChange={e => { setPageInput(e.target.value); const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 1 && n <= pageCount) { setActive({ page: n - 1 }); setViewPage(n - 1); } }} onBlur={() => setPageInput(String((active?.page ?? 0) + 1))} style={ipt} /></div>
                </div>
              </div>
            )}
            {/* send options */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              {/* Fixed at the 30-day Zoho Sign validity — read-only, not user-tunable. */}
              <div><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Days to Sign</div><input type="number" value={expiryDays} readOnly tabIndex={-1} title="Fixed signing window — 30 days" style={{ ...ipt, background: t.dark ? 'rgba(255,255,255,.03)' : '#F1F5F9', color: t.textMuted, cursor: 'default' }} /></div>
              <div><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Note to Signers</div><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...ipt, height: 'auto', padding: '7px 9px', resize: 'vertical' }} /></div>
            </div>
          </div>
        </div>
        {/* footer */}
        <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 600, color: t.textMuted }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>Drag boxes to position · sent securely via Zoho Sign</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => !sending && onClose()} disabled={sending} style={{ padding: '8px 18px', borderRadius: 9, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.1)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 10.5, fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.45 : 1, fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={send} disabled={sending || loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 9, border: 'none', background: sending || loading ? '#C4B5FD' : 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', color: '#fff', fontSize: 10.5, fontWeight: 800, cursor: sending || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(109,40,217,.4)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> {sending ? 'Sending…' : 'Send for Signature'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
