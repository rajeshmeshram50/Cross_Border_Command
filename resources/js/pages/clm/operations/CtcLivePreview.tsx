import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import api from '../../../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker as unknown as string;

/* ── CTC live PDF preview ─────────────────────────────────────────────────────
 * Renders the CURRENT (unsaved) draft HTML through the SAME dompdf pipeline the
 * download uses, so what the author sees here is exactly what the generated PDF
 * will be — true A4 pages, the real footer band, and dompdf's own page breaks.
 * This is the "book view": every page stacked in a scroll, plus prev/next and a
 * live page counter. It refreshes (debounced) as the draft changes.
 *
 * Why a rendered preview instead of paginating the editor itself: TipTap has no
 * real pagination, so the only way to show TRUE pages + footer is to render
 * through the page engine and display the result. See the design discussion in
 * CtcRichEditor (the editor only *estimates* breaks). */
type Props = {
  /** Endpoint that renders the draft and streams back a PDF. Defaults to the
   *  CTC one; the HR document-template editor points it at its own. Both take
   *  the same body ({ id, content, *_config }), so only the URL differs. */
  endpoint?: string;
  contractId: number | null;
  content: string;
  pageConfig?: Record<string, unknown>;
  headerConfig?: Record<string, unknown>;
  footerConfig?: Record<string, unknown>;
  dark?: boolean;
};

export default function CtcLivePreview({
  endpoint = '/clm/ctc-contracts/preview-live',
  contractId, content, pageConfig, headerConfig, footerConfig, dark = false,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<any> } | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const pageWrapRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every successful load so the render effect re-runs against the
  // freshly-loaded document even when the page count is unchanged.
  const [docVersion, setDocVersion] = useState(0);

  // Serialise the config objects so the effect only re-fires when they truly
  // change (object identity from the parent changes every render otherwise).
  const cfgKey = JSON.stringify({ p: pageConfig ?? {}, h: headerConfig ?? {}, f: footerConfig ?? {} });

  /* The in-flight request, so a superseded one can be ABORTED.
     Every keystroke past the debounce used to fire a fresh POST while the
     previous one was still streaming its PDF back, so N edits meant N
     concurrent dompdf renders competing for the same php-fpm workers -- each
     one making the others slower, and the spinner staying up for the SLOWEST
     of them rather than the newest. Only the newest result is ever painted, so
     the older ones are pure waste; cancelling them frees the server
     immediately. */
  const abortRef = useRef<AbortController | null>(null);

  const render = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await api.post(
        endpoint,
        {
          id: contractId ?? undefined,
          content,
          page_config: pageConfig ?? undefined,
          header_config: headerConfig ?? undefined,
          footer_config: footerConfig ?? undefined,
        },
        { responseType: 'blob', signal: ctrl.signal },
      );
      const buf = await (res.data as Blob).arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      docRef.current = pdf as unknown as { numPages: number; getPage: (n: number) => Promise<any> };
      canvasRefs.current = new Array(pdf.numPages).fill(null);
      pageWrapRefs.current = new Array(pdf.numPages).fill(null);
      setNumPages(pdf.numPages);
      setActivePage(p => Math.min(Math.max(1, p), pdf.numPages));
      setDocVersion(v => v + 1);
      setStatus('ready');
    } catch (e: any) {
      /* An abort is this component superseding itself, not a failure: a newer
         render is already running and will set the status. Surfacing it would
         flash "Could not render the preview." on every keystroke. */
      if (ctrl.signal.aborted || e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
      // A blob-typed error response needs decoding to read the JSON message.
      let msg = 'Could not render the preview.';
      try {
        const blob = e?.response?.data;
        if (blob instanceof Blob) { const txt = await blob.text(); const j = JSON.parse(txt); msg = j?.message || msg; }
        else msg = e?.response?.data?.message || msg;
      } catch { /* keep default */ }
      setErrorMsg(msg);
      setStatus('error');
    }
  }, [endpoint, contractId, content, pageConfig, headerConfig, footerConfig]);

  /* Debounced refresh whenever the draft or its layout config changes -- except
     the FIRST one, which runs immediately.
     The debounce exists to coalesce keystrokes, but it was also applied to the
     initial mount, where there is nothing to coalesce: opening the Template
     Design tab bought a guaranteed ~1s of "Rendering preview..." before the
     request was even sent. Only typing needs the delay. */
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (firstRunRef.current) {
      firstRunRef.current = false;
      void render();
      return;
    }
    debounceRef.current = setTimeout(() => { void render(); }, 900);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, cfgKey, contractId]);

  // Drop any in-flight render when the preview unmounts (tab switch, modal close).
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Paint every page onto its canvas, fit to the panel width.
  useEffect(() => {
    if (status !== 'ready') return;
    const doc = docRef.current;
    const stage = scrollRef.current;
    if (!doc || !stage) return;
    let cancelled = false;
    /* The RenderTask has to be held so it can be CANCELLED.
     *
     * Without this the cleanup only flipped `cancelled`, which stops the loop
     * starting the next page but does nothing about the paint already running
     * on the current one. Re-render while that is in flight — which is exactly
     * what uploading a document does — and two tasks target the same canvas at
     * once, while `canvas.width = …` resets it underneath both. pdf.js does not
     * defend against that: the output is a half-painted or inverted page, and
     * page 1 gets it every time because it is the one always mid-paint when the
     * new render begins. That is the reported "first page glitches / flips". */
    let task: { cancel: () => void } | null = null;
    (async () => {
      for (let i = 1; i <= doc.numPages; i++) {
        const canvas = canvasRefs.current[i - 1];
        if (!canvas) continue;
        const page = await doc.getPage(i);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const avail = Math.max(240, stage.clientWidth - 32);
        const scale = Math.min(1.6, avail / base.width);
        const vp = page.getViewport({ scale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const t = page.render({ canvasContext: ctx, viewport: vp });
        task = t;
        try {
          await t.promise;
        } catch {
          /* A cancelled task rejects. That is the normal path when a newer
             render supersedes this one, so it is not an error worth surfacing. */
          return;
        }
        task = null;
        if (cancelled) return;
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [status, docVersion]);

  // Keep the page counter in sync with the scroll position.
  const onScroll = () => {
    const stage = scrollRef.current;
    if (!stage) return;
    const mid = stage.scrollTop + stage.clientHeight / 2;
    let cur = 1;
    for (let i = 0; i < pageWrapRefs.current.length; i++) {
      const el = pageWrapRefs.current[i];
      if (el && el.offsetTop <= mid) cur = i + 1;
    }
    setActivePage(cur);
  };

  const goto = (n: number) => {
    const next = Math.min(numPages, Math.max(1, n));
    const el = pageWrapRefs.current[next - 1];
    const stage = scrollRef.current;
    if (el && stage) stage.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    setActivePage(next);
  };

  const bg = dark ? '#100c1c' : '#e8eaf2';
  const barBg = dark ? 'rgba(255,255,255,.04)' : '#f6f3ff';
  const border = dark ? 'rgba(124,58,237,.25)' : '#EDE9FE';
  const fg = dark ? '#c4b5fd' : '#6D28D9';

  const navBtn = (disabled: boolean): React.CSSProperties => ({
    width: 28, height: 28, borderRadius: 7, border: 'none', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
    color: '#fff', background: 'linear-gradient(135deg,#6D28D9,#7C3AED)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: bg, borderLeft: `1.5px solid ${border}` }}>
      {/* preview toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 10px', background: barBg, borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          <span style={{ fontSize: 10, fontWeight: 800, color: fg, letterSpacing: '.03em' }}>Live PDF Preview</span>
          {status === 'loading' && (
            <svg className="ctc-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2.6" strokeLinecap="round" style={{ marginLeft: 4 }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" style={navBtn(activePage <= 1)} disabled={activePage <= 1} onClick={() => goto(activePage - 1)} title="Previous page">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span style={{ fontSize: 10, fontWeight: 700, color: fg, minWidth: 54, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {numPages ? `${activePage} / ${numPages}` : '—'}
          </span>
          <button type="button" style={navBtn(activePage >= numPages)} disabled={activePage >= numPages} onClick={() => goto(activePage + 1)} title="Next page">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          <button type="button" style={{ ...navBtn(false), background: dark ? 'rgba(124,58,237,.25)' : '#EDE9FE', color: fg }} onClick={() => void render()} title="Refresh preview now">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
        </div>
      </div>

      {/* scrollable stack of pages (the "book") */}
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {status === 'error' && (
          <div style={{ margin: 'auto', textAlign: 'center', color: dark ? '#fca5a5' : '#b91c1c', fontSize: 12, fontWeight: 600, maxWidth: 260 }}>
            {errorMsg || 'Could not render the preview.'}
            <div style={{ marginTop: 10 }}>
              <button type="button" onClick={() => void render()} style={{ padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${border}`, background: barBg, color: fg, fontWeight: 700, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
            </div>
          </div>
        )}
        {status !== 'error' && numPages === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: dark ? '#a78bfa' : '#A78BFA', fontSize: 11.5, fontWeight: 600 }}>
            {status === 'loading' ? 'Rendering preview…' : 'Preview will appear here.'}
          </div>
        )}
        {Array.from({ length: numPages }).map((_, i) => (
          <div
            key={i}
            ref={el => { pageWrapRefs.current[i] = el; }}
            style={{ width: '100%', maxWidth: 720, boxShadow: '0 6px 22px rgba(8,3,28,.22)', borderRadius: 2, background: '#fff', lineHeight: 0 }}
          >
            <canvas ref={el => { canvasRefs.current[i] = el; }} style={{ display: 'block', width: '100%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
