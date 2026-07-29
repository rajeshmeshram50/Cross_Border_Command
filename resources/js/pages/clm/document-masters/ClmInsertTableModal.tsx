import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ───────────────────────────────────────────────────────────────────────
 * Insert Table — small modal shared by the Trade Document Draft Stage 2
 * editor and the Send-for-Signature preview editor.
 *
 * The dialog collects four values: row count, column count, header cell
 * background colour, header cell text colour. On confirm it returns an
 * HTML string built with inline styles (since the contentEditable target
 * is exported as raw HTML and rendered through dompdf — neither honours
 * a separate stylesheet). The caller pastes that HTML at the current
 * caret via document.execCommand('insertHTML').
 *
 * Cell defaults match the body-table styling the PDF blade applies
 * (1px slate border, 6×8 padding) so a freshly-inserted table looks
 * identical in the SPA preview and the rendered PDF.
 * ─────────────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the generated HTML when the user clicks Insert. */
  onInsert: (html: string) => void;
}

const MIN_ROWS = 1;
const MAX_ROWS = 30;
const MIN_COLS = 1;
const MAX_COLS = 10;

export default function ClmInsertTableModal({ open, onClose, onInsert }: Props) {
  const [rows, setRows]           = useState(3);
  const [cols, setCols]           = useState(3);
  const [headerBg, setHeaderBg]   = useState('#0d9488');
  const [headerFg, setHeaderFg]   = useState('#ffffff');
  /* Body striping is a common ask — toggle drives an inline
   * `background-color` on every other row. Off by default since most
   * trade docs prefer a plain look. */
  const [striped, setStriped]     = useState(false);
  const [inserting, setInserting] = useState(false);   // brief spinner on Insert (QA #27)
  /* Caret-restore: parent stashes the editor selection BEFORE opening
   * this modal so insertHTML targets the right spot. Nothing to do
   * here — the parent owns that bookkeeping. */

  // Reset on open so re-opening with the same modal instance doesn't
  // carry over the last table's settings.
  useEffect(() => {
    if (open) {
      setRows(3); setCols(3);
      setHeaderBg('#0d9488'); setHeaderFg('#ffffff');
      setStriped(false);
      // Also clear the "Inserting…" spinner — handleInsert closes the modal
      // without resetting it, so re-opening the same instance was stuck showing
      // "Inserting…" with the button disabled.
      setInserting(false);
    }
  }, [open]);

  // Esc-to-close. Scoped to mount so other modals stacked on top get
  // first crack at the keystroke.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (open) setTimeout(() => firstFieldRef.current?.focus(), 30); }, [open]);

  if (!open) return null;

  const clampRows = (n: number) => Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round(n)));
  const clampCols = (n: number) => Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(n)));

  const buildHtml = (): string => {
    const r = clampRows(rows);
    const c = clampCols(cols);
    // overflow-wrap + word-break keep long/unbreakable text INSIDE its cell so a
    // fixed-layout column never grows to fit it (which was resizing every other
    // column and shoving the table sideways).
    const headerCellStyle = [
      `background:${headerBg}`,
      `color:${headerFg}`,
      'padding:6px 8px',
      'border:1px solid #cbd5e1',
      'text-align:left',
      'font-weight:700',
      'overflow-wrap:break-word',
      'word-break:break-word',
    ].join(';');
    const bodyCellStyle = [
      'padding:6px 8px',
      'border:1px solid #cbd5e1',
      'vertical-align:top',
      'overflow-wrap:break-word',
      'word-break:break-word',
    ].join(';');
    const stripeBg = '#f8fafc';

    const headerCells = Array.from({ length: c }, (_, i) =>
      `<th style="${headerCellStyle}">Header ${i + 1}</th>`,
    ).join('');
    const headerRow = `<thead><tr>${headerCells}</tr></thead>`;

    const bodyRows = Array.from({ length: r }, (_, ri) => {
      const rowStyle = striped && ri % 2 === 1 ? ` style="background:${stripeBg}"` : '';
      const cells = Array.from({ length: c }, () =>
        `<td style="${bodyCellStyle}">&nbsp;</td>`,
      ).join('');
      return `<tr${rowStyle}>${cells}</tr>`;
    }).join('');

    // Wrap in an overflow-x:auto container so a wide table (more columns than
    // the editor width) gets a horizontal scrollbar instead of overflowing.
    return (
      `<div style="overflow-x:auto;max-width:100%;margin:8px 0">`
      + `<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px">`
      + headerRow
      + `<tbody>${bodyRows}</tbody>`
      + `</table></div><p><br></p>`
    );
  };

  const handleInsert = () => {
    if (inserting) return;
    setInserting(true);
    const html = buildHtml();
    // Brief spinner so the blue Insert button shows visible progress (QA #27).
    window.setTimeout(() => { onInsert(html); onClose(); }, 450);
  };

  return createPortal(
    <div
      className="itm-overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Insert Table"
    >
      <style>{ITM_CSS}</style>
      <div className="itm-shell" onMouseDown={e => e.stopPropagation()}>
        {/* ── Head ── */}
        <div className="itm-head">
          <div className="itm-head-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </div>
          <div className="itm-head-text">
            <div className="itm-head-title">Insert Table</div>
            <div className="itm-head-sub">Pick the grid size and header colours.</div>
          </div>
          <button type="button" className="itm-head-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div className="itm-body">
          <div className="itm-grid">
            <label className="itm-field">
              <span className="itm-lbl">Rows</span>
              <input
                ref={firstFieldRef}
                type="number" min={MIN_ROWS} max={MAX_ROWS}
                value={rows}
                onChange={e => setRows(clampRows(Number(e.target.value) || 1))}
                className="itm-input"
              />
              <small className="itm-hint">{MIN_ROWS}–{MAX_ROWS}</small>
            </label>
            <label className="itm-field">
              <span className="itm-lbl">Columns</span>
              <input
                type="number" min={MIN_COLS} max={MAX_COLS}
                value={cols}
                onChange={e => setCols(clampCols(Number(e.target.value) || 1))}
                className="itm-input"
              />
              <small className="itm-hint">{MIN_COLS}–{MAX_COLS}</small>
            </label>
          </div>

          <div className="itm-grid">
            <label className="itm-field">
              <span className="itm-lbl">Header Background</span>
              <div className="itm-color-row">
                <input type="color" value={headerBg} onChange={e => setHeaderBg(e.target.value)} className="itm-color-swatch" />
                <input type="text" value={headerBg} onChange={e => setHeaderBg(e.target.value)} className="itm-input itm-color-input" />
              </div>
            </label>
            <label className="itm-field">
              <span className="itm-lbl">Header Text Colour</span>
              <div className="itm-color-row">
                <input type="color" value={headerFg} onChange={e => setHeaderFg(e.target.value)} className="itm-color-swatch" />
                <input type="text" value={headerFg} onChange={e => setHeaderFg(e.target.value)} className="itm-input itm-color-input" />
              </div>
            </label>
          </div>

          <label className="itm-toggle">
            <input type="checkbox" checked={striped} onChange={e => setStriped(e.target.checked)} />
            <span>Stripe alternate body rows</span>
          </label>

          {/* ── Live preview ── */}
          <div className="itm-preview-label">Preview</div>
          <div className="itm-preview-wrap">
            <div className="itm-preview-scale" dangerouslySetInnerHTML={{ __html: buildHtml() }} />
          </div>
        </div>

        {/* ── Foot ── */}
        <div className="itm-foot">
          <button type="button" className="itm-btn itm-btn-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="itm-btn itm-btn-primary" disabled={inserting} onClick={handleInsert}>
            {inserting
              ? <svg className="itm-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.5" /></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
            {inserting ? 'Inserting…' : 'Insert Table'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const ITM_CSS = `
.itm-overlay {
  position: fixed; inset: 0; z-index: 270000;
  background: rgba(7, 30, 50, .55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 18px;
  font-family: var(--font-sans);
}
.itm-shell {
  width: 100%; max-width: 520px;
  background: #fff; border-radius: 14px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, .35);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 36px);
  overflow: hidden;
}
.itm-head {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 18px;
  background: linear-gradient(135deg, #0d9488 0%, #14b8a6 60%, #5eead4 100%);
  color: #fff;
}
.itm-head-ico {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255,255,255,0.18);
  display: inline-flex; align-items: center; justify-content: center;
}
.itm-head-text { flex: 1; min-width: 0; }
.itm-head-title { font-size: 15px; font-weight: 800; }
.itm-head-sub   { font-size: 12px; opacity: 0.85; margin-top: 2px; }
.itm-head-close {
  width: 28px; height: 28px; border-radius: 8px; border: 0;
  background: rgba(255,255,255,0.18); color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.itm-head-close:hover { background: rgba(255,255,255,0.28); }

.itm-body { padding: 18px; overflow-y: auto; }
.itm-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  margin-bottom: 12px;
}
.itm-field { display: flex; flex-direction: column; gap: 4px; }
.itm-lbl   { font-size: 10.5px; font-weight: 800; letter-spacing: 0.4px; color: #6b7280; text-transform: uppercase; }
.itm-input {
  padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 8px;
  font-size: 13px; background: #fff; color: #111827;
}
.itm-input:focus { outline: 2px solid #14b8a6; outline-offset: 1px; border-color: transparent; }
.itm-hint { color: #94a3b8; font-size: 10.5px; }
.itm-color-row { display: flex; align-items: center; gap: 6px; }
.itm-color-swatch {
  width: 36px; height: 32px; padding: 2px; border-radius: 6px;
  border: 1px solid #e5e7eb; background: #fff; cursor: pointer;
}
.itm-color-input { flex: 1; font-family: monospace; font-size: 12px; }
.itm-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  margin: 4px 0 14px;
  font-size: 13px; color: #374151; cursor: pointer;
}
.itm-toggle input { accent-color: #0d9488; }

.itm-preview-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.4px;
  color: #6b7280; text-transform: uppercase; margin-bottom: 6px;
}
.itm-preview-wrap {
  border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 10px; background: #fafafa;
  max-height: 200px; overflow: auto;
}
.itm-preview-scale { font-size: 11.5px; color: #1f2937; }
.itm-preview-scale table { width: 100%; border-collapse: collapse; }
.itm-preview-scale th, .itm-preview-scale td { font-size: 11.5px; }

.itm-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 18px; border-top: 1px solid #f1f5f9; background: #f9fafb;
}
.itm-btn {
  padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 700;
  border: 1px solid transparent; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.itm-btn-cancel { background: #fff; color: #374151; border-color: #e5e7eb; }
.itm-btn-cancel:hover { background: #f3f4f6; }
.itm-btn-primary {
  background: linear-gradient(135deg, #047857 0%, #0d9488 60%, #14b8a6 100%);
  color: #fff; border-color: transparent;
}
.itm-btn-primary:hover { filter: brightness(1.05); }
.itm-btn-primary:disabled { opacity: .75; cursor: default; }
@keyframes itmSpin { to { transform: rotate(360deg); } }
.itm-spin { animation: itmSpin .7s linear infinite; }

/* Use explicit slate tones (not just var(--vz-card-bg) which renders too
 * close to the page behind) so the modal shell visibly lifts off the
 * dark page. Shell is the lightest band, body slightly darker, foot
 * back to mid-slate — gives clear card hierarchy in dark mode. */
[data-bs-theme="dark"] .itm-shell {
  background: #1e293b;
  box-shadow: 0 24px 48px rgba(0, 0, 0, .55), 0 0 0 1px rgba(6,182,212,.18);
}
[data-bs-theme="dark"] .itm-body { background: #172033; }
[data-bs-theme="dark"] .itm-input,
[data-bs-theme="dark"] .itm-color-input {
  background: #0f172a; color: #e2e8f0; border-color: rgba(6,182,212,.25);
}
[data-bs-theme="dark"] .itm-preview-wrap { background: #0f172a; border-color: rgba(6,182,212,.22); }
[data-bs-theme="dark"] .itm-foot { background: #1e293b; border-top-color: rgba(6,182,212,.18); }
[data-bs-theme="dark"] .itm-btn-cancel { background: #0f172a; color: #cbd5e1; border-color: rgba(148,163,184,.30); }
[data-bs-theme="dark"] .itm-btn-cancel:hover { background: #1e293b; }
/* The body labels (ROWS / COLUMNS / HEADER BACKGROUND / HEADER TEXT COLOUR
 * / PREVIEW), hint text (1–30 / 1–10), the "Stripe alternate body rows"
 * toggle, and the color-picker swatch all keep their light-mode greys when
 * the rest of the modal turns dark — they wash out against the dark panel.
 * Bring them up to a readable cyan / slate palette here. */
[data-bs-theme="dark"] .itm-lbl { color: #67e8f9; }
[data-bs-theme="dark"] .itm-hint { color: #94a3b8; }
[data-bs-theme="dark"] .itm-toggle { color: var(--vz-body-color); }
[data-bs-theme="dark"] .itm-preview-label { color: #67e8f9; }
[data-bs-theme="dark"] .itm-preview-scale { color: var(--vz-body-color); }
[data-bs-theme="dark"] .itm-color-swatch {
  background: var(--vz-secondary-bg); border-color: var(--vz-border-color);
}
`;
