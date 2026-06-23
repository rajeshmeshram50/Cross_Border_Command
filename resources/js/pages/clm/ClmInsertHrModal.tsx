import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ───────────────────────────────────────────────────────────────────────
 * Insert Horizontal Line — shared by the Trade Document Draft Stage 2
 * editor and the Send-for-Signature body editor.
 *
 * Replaces document.execCommand('insertHorizontalRule') (which inserts
 * a plain default <hr> that no styling carries through) with a styled
 * <hr> whose color, height, style, width and spacing the user picks
 * up-front. Every property goes onto an inline `style` attribute so
 * the styling survives the editor → backend → dompdf round trip
 * (dompdf only honours inline styles on <hr>, not CSS classes).
 *
 * Output forms:
 *   - solid →  <hr style="border:0;height:Npx;background:COLOR;…">
 *   - dashed/dotted/double → <hr style="border:0;border-top:Npx STYLE COLOR;…">
 *
 * Solid uses `height + background` rather than `border-top` because
 * dompdf renders that combination noticeably crisper at thin sizes.
 * ─────────────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the generated HTML when the user clicks Insert. */
  onInsert: (html: string) => void;
}

type HrStyle = 'solid' | 'dashed' | 'dotted' | 'double';

const STYLES: { value: HrStyle; label: string }[] = [
  { value: 'solid',  label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'double', label: 'Double' },
];

const PRESET_COLORS = [
  '#0d9488', '#10b981', '#0ea5e9', '#6366f1', '#7c3aed',
  '#f59e0b', '#ef4444', '#6b7280', '#111827', '#cbd5e1',
];

export default function ClmInsertHrModal({ open, onClose, onInsert }: Props) {
  const [color, setColor]   = useState('#0d9488');
  const [height, setHeight] = useState(3);            // px (1–20)
  const [width, setWidth]   = useState(100);          // % (10–100)
  const [style, setStyle]   = useState<HrStyle>('solid');
  const [margin, setMargin] = useState(12);           // vertical margin px (0–48)

  useEffect(() => {
    if (open) {
      setColor('#0d9488'); setHeight(3); setWidth(100);
      setStyle('solid'); setMargin(12);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const firstRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (open) setTimeout(() => firstRef.current?.focus(), 30); }, [open]);

  if (!open) return null;

  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

  const buildHtml = (): string => {
    const h = clamp(height, 1, 20);
    const w = clamp(width, 10, 100);
    const m = clamp(margin, 0, 48);
    const widthStyle = w < 100 ? `width:${w}%;margin-left:auto;margin-right:auto;` : 'width:100%;';
    const marginStyle = `margin-top:${m}px;margin-bottom:${m}px;`;

    if (style === 'solid') {
      // Solid bars render crisper via height+background than border-top.
      const styleAttr = `border:0;height:${h}px;background:${color};${marginStyle}${widthStyle}`;
      return `<hr style="${styleAttr}"><p><br></p>`;
    }
    // dashed / dotted / double need an actual border to take effect.
    const styleAttr = `border:0;border-top:${h}px ${style} ${color};height:0;${marginStyle}${widthStyle}`;
    return `<hr style="${styleAttr}"><p><br></p>`;
  };

  const handleInsert = () => {
    onInsert(buildHtml());
    onClose();
  };

  return createPortal(
    <div
      className="ihr-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Insert Horizontal Line"
    >
      <style>{IHR_CSS}</style>
      <div className="ihr-shell" onMouseDown={e => e.stopPropagation()}>
        <div className="ihr-head">
          <div className="ihr-head-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          </div>
          <div className="ihr-head-text">
            <div className="ihr-head-title">Insert Horizontal Line</div>
            <div className="ihr-head-sub">Pick the colour, thickness, and style.</div>
          </div>
          <button type="button" className="ihr-head-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ihr-body">
          <label className="ihr-field">
            <span className="ihr-lbl">Colour</span>
            <div className="ihr-color-row">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="ihr-color-swatch" />
              <input ref={firstRef} type="text" value={color} onChange={e => setColor(e.target.value)} className="ihr-input ihr-color-input" />
            </div>
            <div className="ihr-presets">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`ihr-preset ${color.toLowerCase() === c.toLowerCase() ? 'is-on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </label>

          <div className="ihr-grid">
            <label className="ihr-field">
              <span className="ihr-lbl">Thickness ({height} px)</span>
              <input
                type="range" min={1} max={20} step={1}
                value={height} onChange={e => setHeight(clamp(Number(e.target.value), 1, 20))}
                className="ihr-range"
              />
            </label>
            <label className="ihr-field">
              <span className="ihr-lbl">Width ({width}%)</span>
              <input
                type="range" min={10} max={100} step={5}
                value={width} onChange={e => setWidth(clamp(Number(e.target.value), 10, 100))}
                className="ihr-range"
              />
            </label>
          </div>

          <div className="ihr-grid">
            <label className="ihr-field">
              <span className="ihr-lbl">Style</span>
              <div className="ihr-style-row">
                {STYLES.map(s => (
                  <button
                    key={s.value} type="button"
                    className={`ihr-chip ${style === s.value ? 'is-on' : ''}`}
                    onClick={() => setStyle(s.value)}
                  >{s.label}</button>
                ))}
              </div>
            </label>
            <label className="ihr-field">
              <span className="ihr-lbl">Spacing above/below ({margin} px)</span>
              <input
                type="range" min={0} max={48} step={2}
                value={margin} onChange={e => setMargin(clamp(Number(e.target.value), 0, 48))}
                className="ihr-range"
              />
            </label>
          </div>

          <div className="ihr-preview-label">Preview</div>
          <div className="ihr-preview-wrap">
            <div className="ihr-preview-scale" dangerouslySetInnerHTML={{ __html: buildHtml() }} />
          </div>
        </div>

        <div className="ihr-foot">
          <button type="button" className="ihr-btn ihr-btn-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="ihr-btn ihr-btn-primary" onClick={handleInsert}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Insert Line
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const IHR_CSS = `
.ihr-overlay {
  position: fixed; inset: 0; z-index: 270000;
  background: rgba(7, 30, 50, .55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  font-family: var(--font-sans);
}
.ihr-shell {
  width: 100%; max-width: 480px;
  background: #fff; border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, .35);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 36px);
  overflow: hidden;
}
.ihr-head {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 18px;
  background: linear-gradient(135deg, #0d9488 0%, #14b8a6 60%, #5eead4 100%);
  color: #fff;
}
.ihr-head-ico {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,0.18);
  display: inline-flex; align-items: center; justify-content: center;
}
.ihr-head-text { flex: 1; min-width: 0; }
.ihr-head-title { font-size: 15px; font-weight: 800; }
.ihr-head-sub   { font-size: 12px; opacity: 0.85; margin-top: 2px; }
.ihr-head-close {
  width: 28px; height: 28px; border-radius: 8px; border: 0;
  background: rgba(255,255,255,0.18); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.ihr-head-close:hover { background: rgba(255,255,255,0.28); }

.ihr-body { padding: 16px 18px; overflow-y: auto; }
.ihr-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.ihr-lbl   { font-size: 10.5px; font-weight: 800; letter-spacing: 0.4px; color: #6b7280; text-transform: uppercase; }
.ihr-input {
  padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px;
  font-size: 13px; background: #fff; color: #111827;
}
.ihr-color-row { display: flex; align-items: center; gap: 6px; }
.ihr-color-swatch {
  width: 36px; height: 32px; padding: 2px; border-radius: 6px;
  border: 1px solid #e5e7eb; background: #fff; cursor: pointer;
}
.ihr-color-input { flex: 1; font-family: monospace; font-size: 12px; }
.ihr-presets {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;
}
.ihr-preset {
  width: 24px; height: 24px; border-radius: 6px;
  border: 2px solid transparent; cursor: pointer; padding: 0;
}
.ihr-preset.is-on { border-color: #111827; box-shadow: 0 0 0 2px #fff inset; }

.ihr-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.ihr-range { accent-color: #0d9488; width: 100%; }
.ihr-style-row { display: flex; gap: 6px; flex-wrap: wrap; }
.ihr-chip {
  padding: 6px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;
  background: #fff; color: #374151; border: 1px solid #e5e7eb; cursor: pointer;
}
.ihr-chip.is-on { background: #0d9488; color: #fff; border-color: #0d9488; }

.ihr-preview-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.4px;
  color: #6b7280; text-transform: uppercase; margin: 4px 0 6px;
}
.ihr-preview-wrap {
  border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 14px; background: #fafafa;
}

.ihr-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 18px; border-top: 1px solid #f1f5f9; background: #f9fafb;
}
.ihr-btn {
  padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
  border: 1px solid transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.ihr-btn-cancel { background: #fff; color: #374151; border-color: #e5e7eb; }
.ihr-btn-cancel:hover { background: #f3f4f6; }
.ihr-btn-primary {
  background: linear-gradient(135deg, #047857 0%, #0d9488 60%, #14b8a6 100%);
  color: #fff; border-color: transparent;
}
.ihr-btn-primary:hover { filter: brightness(1.05); }

[data-bs-theme="dark"] .ihr-shell { background: var(--vz-card-bg); }
[data-bs-theme="dark"] .ihr-input,
[data-bs-theme="dark"] .ihr-color-input {
  background: var(--vz-secondary-bg); color: var(--vz-body-color); border-color: var(--vz-border-color);
}
[data-bs-theme="dark"] .ihr-preview-wrap { background: var(--vz-secondary-bg); border-color: var(--vz-border-color); }
[data-bs-theme="dark"] .ihr-chip { background: var(--vz-card-bg); color: var(--vz-body-color); border-color: var(--vz-border-color); }
[data-bs-theme="dark"] .ihr-chip.is-on { background: #0d9488; color: #fff; }
[data-bs-theme="dark"] .ihr-foot { background: var(--vz-secondary-bg); border-top-color: var(--vz-border-color); }
[data-bs-theme="dark"] .ihr-btn-cancel { background: var(--vz-card-bg); color: var(--vz-body-color); border-color: var(--vz-border-color); }
`;
