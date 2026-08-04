import { useEffect, useMemo, useRef, useState } from 'react';

// Inline SVG pencil — yellow body, dark tip pointing down-left so the user
// feels like they're drawing from the nib. Encoded as a UTF-8 data URI.
const PENCIL_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>"
  + "<path d='M14.06 4.94l4 4L8 19H4v-4z' fill='%23fde047' stroke='%23713f12' stroke-width='1' stroke-linejoin='round'/>"
  + "<path d='M14.06 4.94l2.83-2.83a1 1 0 0 1 1.41 0l1.59 1.59a1 1 0 0 1 0 1.41L17.06 7.94z' fill='%237c5cfc' stroke='%23312e81' stroke-width='1' stroke-linejoin='round'/>"
  + "<path d='M4 19l1.5 1.5L4 22z' fill='%23111827'/>"
  + "</svg>\") 2 22, crosshair";

// Google Fonts used in the Type tab. Loaded once, lazily, on first mount.
const TYPE_FONTS = [
  { id: 'caveat',        label: 'Caveat',         family: 'Caveat, cursive' },
  { id: 'dancing',       label: 'Dancing Script', family: '"Dancing Script", cursive' },
  { id: 'great-vibes',   label: 'Great Vibes',    family: '"Great Vibes", cursive' },
  { id: 'sacramento',    label: 'Sacramento',     family: 'Sacramento, cursive' },
  { id: 'pacifico',      label: 'Pacifico',       family: 'Pacifico, cursive' },
  { id: 'allura',        label: 'Allura',         family: 'Allura, cursive' },
] as const;

const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Allura&family=Caveat:wght@500&family=Dancing+Script:wght@600&family=Great+Vibes&family=Pacifico&family=Sacramento&display=swap';

// One-shot stylesheet injection — re-mounting the component must not append
// duplicate <link> tags. Keyed by href so other parts of the app can share.
const ensureGoogleFonts = () => {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[data-sigpad-fonts="1"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONTS_HREF;
  link.setAttribute('data-sigpad-fonts', '1');
  document.head.appendChild(link);
};

// Render a typed signature into a fresh canvas and return its PNG data URL.
// Auto-shrinks the font size until the text fits, so very long names still
// produce a sensible image instead of overflowing.
const renderTypedToPng = (
  text: string,
  fontFamily: string,
  color: string,
  cssW: number,
  cssH: number,
): string => {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  let size = Math.floor(cssH * 0.7);
  for (; size > 14; size -= 2) {
    ctx.font = `${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= cssW - 24) break;
  }
  ctx.font = `${size}px ${fontFamily}`;
  const m = ctx.measureText(text);
  ctx.fillText(text, Math.max(12, (cssW - m.width) / 2), cssH / 2);
  return canvas.toDataURL('image/png');
};

/**
 * Wording for the mandatory informed-consent tick shown before any document
 * action. Every action carries the same "I have read and understood this"
 * claim, so the sentence is identical apart from the verb — saying "agree to
 * sign it" on an Approve button would be plainly wrong. Shared by the Inbox,
 * My Team and HR onboarding action modals so the three never drift.
 * Mirrors the server-side gate in HrDocumentSignatureController::action.
 */
export const consentLabel = (action?: string | null): string => {
  const a = String(action ?? '').toLowerCase();
  if (a.includes('approve')) return 'I have read and understood the document and agree to approve it.';
  if (a.includes('acknowledge')) return 'I have read and understood the document and acknowledge it.';
  return 'I have read and understood the document and agree to sign it.';
};

export interface SignaturePadValue {
  dataUrl: string | null;
  isEmpty: boolean;
}

export type SignatureMode = 'type' | 'draw' | 'upload';

export default function SignaturePad({
  value,
  onChange,
  height = 160,
  penColor = '#1d4ed8',
  penWidth = 2.2,
  disabled = false,
  typedName,
  defaultMode,
}: {
  value?: string | null;
  onChange: (v: SignaturePadValue) => void;
  height?: number;
  penColor?: string;
  penWidth?: number;
  disabled?: boolean;
  /** Name shown in the Type tab gallery. When omitted the Type tab is hidden. */
  typedName?: string;
  /** Which tab to open first. Defaults to 'type' when typedName is given, else 'draw'. */
  defaultMode?: SignatureMode;
}) {
  const hasTypeTab = typeof typedName === 'string';
  const [mode, setMode] = useState<SignatureMode>(
    defaultMode ?? (hasTypeTab && typedName!.trim() ? 'type' : 'draw'),
  );

  // Each tab tracks its own dataUrl so users can flip back and forth without
  // losing work. The parent always sees whatever the currently active tab
  // has produced (via the mode-switch effect below).
  const [typedUrl,    setTypedUrl]    = useState<string | null>(null);
  const [drawnUrl,    setDrawnUrl]    = useState<string | null>(value ?? null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [selectedFont, setSelectedFont] = useState<string>(TYPE_FONTS[0].id);

  useEffect(() => { ensureGoogleFonts(); }, []);

  // Whenever the active tab changes, re-emit that tab's current value so the
  // parent's submit-enabled state stays in sync with what the user sees.
  useEffect(() => {
    const v = mode === 'type' ? typedUrl : mode === 'draw' ? drawnUrl : uploadedUrl;
    onChange({ dataUrl: v, isEmpty: !v });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ── Type-tab rendering ─────────────────────────────────────────────────────
  // Re-render the typed PNG whenever the name or selected font changes. We
  // wait for the chosen webfont to load before painting so the canvas doesn't
  // get a fallback-glyph snapshot.
  useEffect(() => {
    if (!hasTypeTab) return;
    const name = (typedName || '').trim();
    if (!name) {
      setTypedUrl(null);
      if (mode === 'type') onChange({ dataUrl: null, isEmpty: true });
      return;
    }
    const font = TYPE_FONTS.find(f => f.id === selectedFont) || TYPE_FONTS[0];
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const url = renderTypedToPng(name, font.family, penColor, 460, 110);
      setTypedUrl(url);
      if (mode === 'type') onChange({ dataUrl: url, isEmpty: false });
    };
    if ((document as any).fonts?.load) {
      (document as any).fonts.load(`32px ${font.family}`).then(paint, paint);
    } else {
      paint();
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedName, selectedFont, penColor, hasTypeTab]);

  // ── Upload-tab handler ─────────────────────────────────────────────────────
  const onFileChosen = (file: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.type)) {
      alert('Please choose an image file (PNG, JPG, GIF, WEBP, or SVG).');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      alert('Image too large — please use a file under 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setUploadedUrl(url);
      if (mode === 'upload') onChange({ dataUrl: url, isEmpty: !url });
    };
    reader.readAsDataURL(file);
  };

  // Tabs visible to the user — Type is only available when the parent
  // supplied a name source, otherwise it'd be empty by construction.
  const tabs = useMemo<{ id: SignatureMode; label: string; icon: string }[]>(() => {
    const out: { id: SignatureMode; label: string; icon: string }[] = [];
    if (hasTypeTab) out.push({ id: 'type',   label: 'Type',   icon: 'ri-keyboard-line' });
    out.push({ id: 'draw',   label: 'Draw',   icon: 'ri-quill-pen-line' });
    out.push({ id: 'upload', label: 'Upload', icon: 'ri-upload-cloud-2-line' });
    return out;
  }, [hasTypeTab]);

  return (
    <div className="sigpad-root" style={{ width: '100%' }}>
      {/* Tabs */}
      <div className="d-inline-flex" style={{ background: '#f3f4f6', borderRadius: 8, padding: 3, gap: 2, marginBottom: 10 }}>
        {tabs.map(t => {
          const active = mode === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setMode(t.id)} disabled={disabled}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 0,
                background: active ? 'linear-gradient(135deg,#7c5cfc,#a78bfa)' : 'transparent',
                color: active ? '#fff' : '#6b7280',
                fontSize: 12, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
              <i className={t.icon} />{t.label}
            </button>
          );
        })}
      </div>

      {mode === 'type'   && <TypePanel
        typedName={typedName || ''}
        fonts={TYPE_FONTS}
        selectedFont={selectedFont}
        onSelectFont={setSelectedFont}
        penColor={penColor}
      />}
      {mode === 'draw'   && <DrawPanel
        value={value}
        height={height}
        penColor={penColor}
        penWidth={penWidth}
        disabled={disabled}
        onChange={(url) => {
          setDrawnUrl(url);
          onChange({ dataUrl: url, isEmpty: !url });
        }}
      />}
      {mode === 'upload' && <UploadPanel
        uploadedUrl={uploadedUrl}
        disabled={disabled}
        onFile={onFileChosen}
        onClear={() => { setUploadedUrl(null); onChange({ dataUrl: null, isEmpty: true }); }}
      />}
    </div>
  );
}

/* ── Type panel — gallery of font cards ──────────────────────────────────── */
function TypePanel({
  typedName, fonts, selectedFont, onSelectFont, penColor,
}: {
  typedName: string;
  fonts: readonly { id: string; label: string; family: string }[];
  selectedFont: string;
  onSelectFont: (id: string) => void;
  penColor: string;
}) {
  if (!typedName.trim()) {
    return (
      <div style={{
        padding: '28px 20px', borderRadius: 10, border: '1px dashed #c4b5fd',
        background: '#fafaff', color: '#9ca3af', fontSize: 13, textAlign: 'center',
      }}>
        <i className="ri-keyboard-line" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
        Type your name in the field above to see signature styles.
      </div>
    );
  }
  return (
    <div className="sigpad-type-grid" style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 10,
    }}>
      {fonts.map(f => {
        const active = selectedFont === f.id;
        return (
          <button key={f.id} type="button" onClick={() => onSelectFont(f.id)}
            style={{
              textAlign: 'left', padding: '14px 16px',
              border: active ? '2px solid #7c5cfc' : '1px solid #e5e7eb',
              borderRadius: 10, background: active ? '#f5f3ff' : '#fff',
              cursor: 'pointer', transition: 'all 120ms',
              boxShadow: active ? '0 2px 10px rgba(124,92,252,0.18)' : 'none',
            }}>
            <div style={{ fontSize: 10.5, color: '#6b7280', fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase' }}>
              {f.label}
            </div>
            <div style={{
              marginTop: 4, fontFamily: f.family, fontSize: 30, color: penColor,
              lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {typedName}
            </div>
            {active && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#7c5cfc', fontWeight: 700 }}>
                <i className="ri-checkbox-circle-fill me-1" />Selected
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Draw panel — original canvas pad, lifted into its own component ─────── */
function DrawPanel({
  value, height, penColor, penWidth, disabled, onChange,
}: {
  value?: string | null;
  height: number;
  penColor: string;
  penWidth: number;
  disabled: boolean;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef   = useRef<HTMLDivElement   | null>(null);
  const drawingRef = useRef(false);
  const lastRef    = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef   = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    const wrap   = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = height;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = penColor;
    ctx.lineWidth   = penWidth;
  };

  useEffect(() => {
    setupCanvas();
    const obs = new ResizeObserver(() => {
      setupCanvas();
      dirtyRef.current = false;
      setHasInk(false);
      onChange(null);
    });
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate from a parent-supplied data URL (re-editing an existing signature).
  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
      dirtyRef.current = true;
      setHasInk(true);
    };
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const localPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    lastRef.current = localPoint(e);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const from = lastRef.current;
    const to   = localPoint(e);
    if (!ctx || !from) return;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    lastRef.current = to;
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setHasInk(true);
    }
  };
  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(dirtyRef.current ? canvas.toDataURL('image/png') : null);
  };
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    // clearRect alone can leave stray pixels when the context is mid-transform
    // (DPR scaling) — reset the transform, wipe the full device-pixel buffer,
    // then re-init so the pad is pristine and ready to draw again.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setupCanvas();
    dirtyRef.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <div
        style={{
          position: 'relative',
          border: '1px dashed #c4b5fd',
          borderRadius: 10,
          background: '#fafaff',
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onPointerLeave={finishStroke}
          style={{
            display: 'block',
            width: '100%',
            height,
            touchAction: 'none',
            cursor: disabled ? 'not-allowed' : PENCIL_CURSOR,
          }}
        />
        {!hasInk && (
          <div
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
              color: '#9ca3af', fontSize: 13, fontStyle: 'italic',
            }}
          >
            <i className="ri-quill-pen-line me-1" />Draw your signature here
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: 20, right: 20, bottom: '30%',
            height: 1, background: 'rgba(99,102,241,0.20)',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div className="d-flex align-items-center justify-content-between mt-2">
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          <i className="ri-information-line me-1" />Use your mouse, finger, or stylus.
        </div>
        <button type="button" onClick={clear} disabled={disabled || !hasInk}
          style={{
            padding: '5px 12px', borderRadius: 8,
            border: '1px solid #e5e7eb', background: '#fff',
            fontSize: 12, fontWeight: 700, color: '#6b7280',
            cursor: hasInk ? 'pointer' : 'not-allowed', opacity: hasInk ? 1 : 0.55,
          }}>
          <i className="ri-eraser-line me-1" />Clear
        </button>
      </div>
    </div>
  );
}

/* ── Upload panel — drop zone + file input ───────────────────────────────── */
function UploadPanel({
  uploadedUrl, disabled, onFile, onClear,
}: {
  uploadedUrl: string | null;
  disabled: boolean;
  onFile: (f: File | null) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  if (uploadedUrl) {
    return (
      <div style={{
        position: 'relative', border: '1px dashed #c4b5fd', borderRadius: 10,
        background: '#fafaff', padding: 14, textAlign: 'center',
      }}>
        <img src={uploadedUrl} alt="Uploaded signature"
          style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain' }} />
        <div className="d-flex align-items-center justify-content-between mt-2">
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            <i className="ri-checkbox-circle-fill me-1" style={{ color: '#16a34a' }} />
            Image attached — use this signature, or replace it.
          </div>
          <button type="button" onClick={onClear} disabled={disabled}
            style={{
              padding: '5px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
              background: '#fff', fontSize: 12, fontWeight: 700, color: '#6b7280',
              cursor: 'pointer',
            }}>
            <i className="ri-delete-bin-line me-1" />Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      style={{
        display: 'block', cursor: disabled ? 'not-allowed' : 'pointer',
        padding: '32px 20px', borderRadius: 10, textAlign: 'center',
        border: `1px dashed ${dragging ? '#7c5cfc' : '#c4b5fd'}`,
        background: dragging ? '#f5f3ff' : '#fafaff',
        transition: 'all 120ms',
      }}>
      <input ref={inputRef} type="file" accept="image/*" disabled={disabled}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
        style={{ display: 'none' }} />
      <i className="ri-upload-cloud-2-line" style={{ fontSize: 32, color: '#7c5cfc', display: 'block', marginBottom: 6 }} />
      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#374151' }}>
        Click to upload, or drag and drop
      </div>
      <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 4 }}>
        PNG, JPG, GIF, WEBP, or SVG &middot; up to 4&nbsp;MB
      </div>
    </label>
  );
}
