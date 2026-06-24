import { useEffect, useState, type RefObject } from 'react';

/* ───────────────────────────────────────────────────────────────────────
 * Rich-text toolbar — shared by:
 *   - Trade Document Draft Stage 2 editor
 *   - Send-for-Signature → Edit Layout popup body editor
 *
 * Acts on whatever contentEditable element is currently mounted at
 * `editorRef`. The component itself owns no editor state — it just
 * issues document.execCommand calls and pings `onChange` so the
 * parent can sync the current HTML into its own state map.
 *
 * Insert-Table / Insert-HR / Insert-Placeholder buttons are slots so
 * the parent decides which modal to open. Buttons hide automatically
 * when their handler isn't passed in (the popup may not want a
 * Placeholder picker, e.g.).
 *
 * Toolbar buttons preventDefault on mousedown so the editor selection
 * survives the click — execCommand requires the selection to remain
 * inside the contentEditable.
 * ─────────────────────────────────────────────────────────────────────── */

interface Props {
  editorRef: RefObject<HTMLDivElement | null>;
  /** Called after every formatting command + insertion so the parent
   *  can re-read `editorRef.current.innerHTML` into its state map. */
  onChange: () => void;
  /** Stash the current selection so the parent's modals can restore it
   *  on Insert. Optional — most formatting commands keep their own
   *  selection alive via preventDefault on mousedown. */
  onStashSelection?: () => void;

  /** Slot handlers — buttons render only when the handler is provided. */
  onInsertTable?: () => void;
  onInsertHr?: () => void;
  onInsertPlaceholder?: () => void;
  onInsertClause?: () => void;
}

const FONT_SIZES = ['11', '12', '13', '14', '16', '18', '20', '24', '28'];

const HIGHLIGHT_PRESETS = ['#fde68a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#e9d5ff'];

export default function ClmRichTextToolbar({
  editorRef, onChange, onStashSelection,
  onInsertTable, onInsertHr, onInsertPlaceholder, onInsertClause,
}: Props) {
  const [fontSize, setFontSize] = useState('14');
  const [block, setBlock]       = useState('p');

  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    onChange();
  };

  /* applyFontSize — execCommand fontSize accepts 1–7 only. Tag with
   * size="7" then rewrite the resulting <font size="7"> elements into
   * <span style="font-size:Npx"> so arbitrary pixel sizes work. */
  const applyFontSize = (px: string) => {
    editorRef.current?.focus();
    document.execCommand('fontSize', false, '7');
    editorRef.current?.querySelectorAll('font[size="7"]').forEach(f => {
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      span.innerHTML = (f as HTMLElement).innerHTML;
      f.replaceWith(span);
    });
    onChange();
  };

  const applyBlock = (tag: string) => exec('formatBlock', `<${tag}>`);

  const insertLink = () => {
    const url = window.prompt('Enter URL', 'https://');
    if (url) exec('createLink', url);
  };

  // Prevent toolbar mousedown from stealing focus from the editor.
  useEffect(() => { /* no-op; documented in JSX */ }, []);

  // Skip preventDefault for native <select> (font-size / block) so their
  // dropdowns open — they open ON mousedown, which the selection-preserving
  // preventDefault otherwise swallowed.
  return (
    <div className="rtb-bar" onMouseDown={e => { if (!(e.target as HTMLElement).closest('select')) e.preventDefault(); }}>
      <style>{RTB_CSS}</style>

      {/* ── Font size + block format ─────────────────────────── */}
      <select
        className="rtb-sel"
        value={fontSize}
        onChange={e => { setFontSize(e.target.value); applyFontSize(e.target.value); }}
        title="Font size"
      >
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        className="rtb-sel"
        value={block}
        onChange={e => { setBlock(e.target.value); applyBlock(e.target.value); }}
        title="Block format"
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="blockquote">Quote</option>
        <option value="pre">Code</option>
      </select>

      {/* ── Bold / Italic / Underline / Strike / Sup / Sub ───── */}
      <button type="button" className="rtb-btn" onClick={() => exec('bold')}          title="Bold (Ctrl+B)"><b>B</b></button>
      <button type="button" className="rtb-btn" onClick={() => exec('italic')}        title="Italic (Ctrl+I)"><i>I</i></button>
      <button type="button" className="rtb-btn" onClick={() => exec('underline')}     title="Underline (Ctrl+U)"><u>U</u></button>
      <button type="button" className="rtb-btn" onClick={() => exec('strikeThrough')} title="Strikethrough"><s>S</s></button>
      <button type="button" className="rtb-btn" onClick={() => exec('superscript')}   title="Superscript">X²</button>
      <button type="button" className="rtb-btn" onClick={() => exec('subscript')}     title="Subscript">X₂</button>

      {/* ── Text color + Highlight color ─────────────────────── */}
      <label className="rtb-btn rtb-color" title="Text color" style={{ position: 'relative' }}>
        T
        <input
          type="color" defaultValue="#0c4a6e"
          onChange={e => exec('foreColor', e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
        />
      </label>
      <label className="rtb-btn rtb-color" title="Highlight color" style={{ position: 'relative', color: '#f59e0b' }}>
        ✎
        <input
          type="color" defaultValue="#fde68a"
          onChange={e => exec('hiliteColor', e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
        />
      </label>
      {/* Quick highlight palette — saves a trip to the OS colour picker
         for the everyday yellow / mint / sky / pink / lilac. */}
      {HIGHLIGHT_PRESETS.map(c => (
        <button
          key={c}
          type="button"
          className="rtb-swatch"
          title={`Highlight ${c}`}
          onClick={() => exec('hiliteColor', c)}
          style={{ background: c }}
        >&nbsp;</button>
      ))}

      <span className="rtb-sep" />

      {/* ── Alignment ────────────────────────────────────────── */}
      <button type="button" className="rtb-btn" onClick={() => exec('justifyLeft')}    title="Align left">⬅</button>
      <button type="button" className="rtb-btn" onClick={() => exec('justifyCenter')}  title="Align center">↔</button>
      <button type="button" className="rtb-btn" onClick={() => exec('justifyRight')}   title="Align right">➡</button>
      <button type="button" className="rtb-btn" onClick={() => exec('justifyFull')}    title="Justify">≡</button>

      <span className="rtb-sep" />

      {/* ── Lists + Indent ───────────────────────────────────── */}
      <button type="button" className="rtb-btn" onClick={() => exec('insertUnorderedList')} title="Bullet list">•≡</button>
      <button type="button" className="rtb-btn" onClick={() => exec('insertOrderedList')}   title="Numbered list">1≡</button>
      <button type="button" className="rtb-btn" onClick={() => exec('outdent')}             title="Outdent">⇤</button>
      <button type="button" className="rtb-btn" onClick={() => exec('indent')}              title="Indent">⇥</button>

      <span className="rtb-sep" />

      {/* ── Link / HR / Insert slots ─────────────────────────── */}
      <button type="button" className="rtb-btn" onClick={insertLink}          title="Insert link">🔗</button>
      <button type="button" className="rtb-btn" onClick={() => exec('unlink')} title="Remove link">🔗⃠</button>
      {onInsertHr && (
        <button
          type="button" className="rtb-btn"
          title="Insert horizontal line"
          onMouseDown={() => { onStashSelection?.(); }}
          onClick={onInsertHr}
        >—</button>
      )}
      {onInsertTable && (
        <button
          type="button" className="rtb-btn"
          title="Insert table"
          onMouseDown={() => { onStashSelection?.(); }}
          onClick={onInsertTable}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9"  x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9"  y1="3" x2="9"  y2="21"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>
      )}
      {onInsertPlaceholder && (
        <button
          type="button" className="rtb-btn"
          title="Insert placeholder"
          onMouseDown={() => { onStashSelection?.(); }}
          onClick={onInsertPlaceholder}
        >{'{}'}</button>
      )}
      {onInsertClause && (
        <button
          type="button" className="rtb-btn"
          title="Clause Library"
          onMouseDown={() => { onStashSelection?.(); }}
          onClick={onInsertClause}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
        </button>
      )}

      <span className="rtb-sep" />

      {/* ── History / Clear ──────────────────────────────────── */}
      <button type="button" className="rtb-btn" onClick={() => exec('undo')}         title="Undo">↶</button>
      <button type="button" className="rtb-btn" onClick={() => exec('redo')}         title="Redo">↷</button>
      <button type="button" className="rtb-btn" onClick={() => exec('removeFormat')} title="Clear formatting">🅣</button>
    </div>
  );
}

const RTB_CSS = `
.rtb-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.rtb-sel {
  height: 28px; padding: 0 8px; font-size: 12px;
  background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
  color: #1f2937; cursor: pointer;
}
.rtb-btn {
  min-width: 28px; height: 28px; padding: 0 8px;
  background: #fff; color: #1f2937;
  border: 1px solid #cbd5e1; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.rtb-btn:hover { background: #eef2ff; border-color: #c7d2fe; color: #4338ca; }
.rtb-btn:active { transform: translateY(1px); }
.rtb-color { font-weight: 800; }
.rtb-swatch {
  width: 22px; height: 28px; padding: 0;
  border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer;
}
.rtb-swatch:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(15,23,42,0.10); }
.rtb-sep {
  width: 1px; height: 18px; background: #e2e8f0; margin: 0 4px;
}

[data-bs-theme="dark"] .rtb-bar { background: var(--vz-secondary-bg); border-color: var(--vz-border-color); }
[data-bs-theme="dark"] .rtb-sel,
[data-bs-theme="dark"] .rtb-btn {
  background: var(--vz-card-bg); color: var(--vz-body-color); border-color: var(--vz-border-color);
}
[data-bs-theme="dark"] .rtb-btn:hover { background: rgba(99,102,241,0.18); color: #c7d2fe; }
[data-bs-theme="dark"] .rtb-sep { background: var(--vz-border-color); }
`;
