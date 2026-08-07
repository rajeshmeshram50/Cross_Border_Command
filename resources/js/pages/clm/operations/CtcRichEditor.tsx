import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { Extension, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, FontSize, Color, BackgroundColor } from '@tiptap/extension-text-style';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
 * TipTap editor building blocks for the CTC Draft Agreement Content editor.
 *
 * Split into a hook + a toolbar + a content CSS string (instead of one bundled
 * component) so the parent can lay them out around its HeaderFooterPanel — the
 * toolbar ABOVE, the editable content INSIDE the page frame — exactly like the
 * HR TemplateEditor. Content is HTML in / HTML out, so the backend contract
 * (draft = HTML string) is unchanged.
 *
 * Replaces the old raw contentEditable + document.execCommand, which choked on
 * large (200-300 page) DOCX uploads (ghost cursors, unrendered content, jank).
 * TipTap owns a real document model + reliable selection, so those go away.
 *
 * Font-size uses TextStyle + FontSize (@tiptap/extension-text-style, pinned to
 * the same 3.23.x as the rest to avoid the peer-dep clash). Paragraph indent is
 * a tiny global-attribute extension (ParagraphIndent, below) that stamps a
 * margin-left on paragraph/heading nodes; the toolbar's indent/outdent buttons
 * nudge list items when inside a list, else nudge the block indent.
 * ────────────────────────────────────────────────────────────────────────── */

// Max nesting + px per indent level for paragraph/heading blocks.
const INDENT_STEP = 28;
const INDENT_MAX = 10;

/* Adds an `indent` attribute (0..INDENT_MAX) to paragraph/heading nodes,
 * serialised as an inline margin-left so it round-trips through the HTML draft
 * and the generated PDF. Commands live in the toolbar (see changeIndent) to
 * avoid TipTap command module-augmentation ceremony. */
/* ── Page flow ─────────────────────────────────────────────────────────────
   Moves a block that would cross a page boundary onto the next sheet, leaving
   the rest of the current one empty — which is exactly what dompdf does with
   the same HTML. Neither engine splits a paragraph, so the blank tail of a
   sheet here is the blank tail that comes out of the PDF.

   Geometry, all read off the PDF (derivation in .ctcte-pageview):
     PAGE_H   printable height of a sheet
     FIRST_H  sheet one, shorter because the document header sits in the flow
              there and nowhere else
     GAP      the band drawn between sheets

   ── Why this measures the DOM's own spacers ──
   The obvious version keeps a running total of the spacer height it has
   inserted and subtracts it to get "natural" positions. It does not converge.
   On the first pass a block has no spacer above it, so its offsetTop is
   natural; on the second the spacer IS above it and offsetTop includes it, but
   the accumulator was only incremented AFTER that block was handled — so the
   two passes disagree about the same block, the decision flips, and the page
   numbers and gap heights oscillate.

   So nothing is accumulated. The spacers are read straight out of the DOM, in
   document order, and their measured heights are subtracted. That frame is the
   same on every pass whatever has already been inserted, so the pass is
   idempotent — run it twice and it produces the identical decoration set. */
const PAGE_H   = 1006;
const HEAD_H   = 94;
const FIRST_H  = PAGE_H - HEAD_H;
const PAGE_GAP = 30;
/* Above this the per-edit measure costs more than it gives — this editor also
   carries 200-300 page DOCX imports. The sheet still renders; only the
   pushing stops. */
const PAGINATE_MAX_BLOCKS = 400;

const pageFlowKey = new PluginKey('ctcPageFlow');

const PageFlow = Extension.create({
  name: 'ctcPageFlow',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pageFlowKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => tr.getMeta(pageFlowKey) ?? old.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => pageFlowKey.getState(state) },
        view(view) {
          let timer = 0;
          let frame = 0;
          let signature = '';

          const measure = () => {
            const dom = view.dom as HTMLElement;
            if (!dom.isConnected || !dom.closest('.ctcte-pageview')) return;
            if (view.state.doc.childCount > PAGINATE_MAX_BLOCKS) return;

            /* Walk the rendered children once, in order. Spacers and content
               blocks are interleaved siblings, so filtering the spacers out
               leaves exactly the document's top-level blocks — and the running
               gap total gives each block's natural (un-spaced) position. */
            /* offsetTop is measured from the nearest POSITIONED ancestor, not
               from .ProseMirror — and .ProseMirror carries no position of its
               own, so every reading was inflated by however far the editor sat
               inside the page shell (toolbar, wrapper padding, …). The first
               sheet therefore looked full long before it was, and the counter
               was already past page 1 by the time the first gap appeared —
               which is why the very first band read "END OF PAGE 2".

               .ctcte-pageview .ProseMirror is now position:relative, so
               offsetTop is relative to it; subtracting its padding-top puts the
               first block at natural 0, matching the PDF where 1006px is the
               PRINTABLE height, margins already excluded. */
            const padTop = parseFloat(getComputedStyle(dom).paddingTop) || 0;

            const natural: { top: number; height: number }[] = [];
            let gapAcc = 0;
            for (const child of Array.from(dom.children) as HTMLElement[]) {
              if (child.classList.contains('ctcte-pagegap')) {
                gapAcc += child.offsetHeight;
                continue;
              }
              natural.push({ top: child.offsetTop - padTop - gapAcc, height: child.offsetHeight });
            }
            // The DOM can lag the doc for one frame after an edit; a mismatch
            // means the measurement would be against stale geometry.
            if (natural.length !== view.state.doc.childCount) return;

            const decos: Decoration[] = [];
            let page = 1;         // sheet currently being filled
            let cap  = FIRST_H;   // natural height available through this sheet
            let i    = 0;

            view.state.doc.forEach((_node, offset) => {
              const m = natural[i++];
              if (!m) return;
              const { top, height } = m;

              // Fits on a sheet, just not on this one → move it down.
              if (height <= PAGE_H && top + height > cap) {
                const fill = cap - top;
                if (fill > 0) {
                  const from = page;
                  decos.push(Decoration.widget(offset, () => {
                    const gap = document.createElement('div');
                    gap.className = 'ctcte-pagegap';
                    gap.style.height = `${fill + PAGE_GAP}px`;
                    gap.setAttribute('data-from', String(from));
                    gap.setAttribute('data-to', String(from + 1));
                    gap.contentEditable = 'false';
                    return gap;
                  }, { side: -1, key: `pg${offset}` }));
                }
                page += 1;
                cap  += PAGE_H;
              }

              // Taller than a whole sheet — nothing to be done, but keep the
              // page count honest for the labels below it.
              while (top + height > cap) { page += 1; cap += PAGE_H; }
            });

            // Dispatch only on a real change, or each pass would trigger the next.
            const sig = decos.map(d => `${(d as any).from}`).join(',');
            if (sig === signature) return;
            signature = sig;
            view.dispatch(
              view.state.tr
                .setMeta(pageFlowKey, DecorationSet.create(view.state.doc, decos))
                .setMeta('addToHistory', false),
            );
          };

          const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(measure);
            }, 160);
          };

          schedule();
          return {
            update: schedule,
            destroy() { window.clearTimeout(timer); cancelAnimationFrame(frame); },
          };
        },
      }),
    ];
  },
});

/**
 * An explicit page break.
 *
 * dompdf already honours page-break-* (the signature-document blade leans on it
 * throughout), but the editor had no way to EMIT one — a drafter could see a
 * clause land across two pages in the generated PDF and had no control over it
 * beyond padding the text with blank lines.
 *
 * Serialises to `<div class="page-break"></div>`, which the PDF stylesheet turns
 * into `page-break-after: always`. In the browser the same element is styled as
 * a labelled dashed rule, so the break is visible while writing. Being a plain
 * div means an older draft round-trips untouched and the backend contract
 * (draft = HTML string) is unchanged.
 */
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,          // one indivisible thing — no cursor inside it
  selectable: true,
  parseHTML() {
    return [{ tag: 'div.page-break' }, { tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    // data-page-break as well as the class: a stylesheet can be stripped or
    // overridden, but the attribute survives for the PDF side to match on.
    return ['div', { class: 'page-break', 'data-page-break': 'true' }];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ chain }: any) =>
        // Insert the break AND a paragraph after it, otherwise an atom at the
        // end of the doc leaves nowhere to put the caret.
        chain().insertContent([{ type: 'pageBreak' }, { type: 'paragraph' }]).run(),
    } as any;
  },
});

const ParagraphIndent = Extension.create({
  name: 'paragraphIndent',
  addOptions() { return { types: ['paragraph', 'heading'] as string[] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element: HTMLElement) => {
            const ml = parseInt(element.style.marginLeft || '0', 10);
            return ml ? Math.min(INDENT_MAX, Math.round(ml / INDENT_STEP)) : 0;
          },
          renderHTML: (attributes: { indent?: number }) =>
            attributes.indent ? { style: `margin-left: ${attributes.indent * INDENT_STEP}px` } : {},
        },
      },
    }];
  },
});

/* Preserve the inline `style` attribute on table nodes. TipTap's default table
 * extensions drop arbitrary `style`, which stripped the border/background the
 * Insert-Table modal writes inline — so inserted tables lost their borders and
 * the PDF had to force a border on EVERY cell, which then boxed up clause /
 * layout tables that were never meant to have borders. Keeping the inline style
 * lets a bordered table stay bordered and a borderless one stay clean, in both
 * the editor and the generated PDF. */
const keepStyleAttr = {
  style: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('style'),
    renderHTML: (attrs: { style?: string | null }) => (attrs.style ? { style: attrs.style } : {}),
  },
};
const StyledTable = Table.extend({ addAttributes() { return { ...this.parent?.(), ...keepStyleAttr }; } });
const StyledTableRow = TableRow.extend({ addAttributes() { return { ...this.parent?.(), ...keepStyleAttr }; } });
const StyledTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...keepStyleAttr }; } });
const StyledTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...keepStyleAttr }; } });

export interface CtcEditor {
  editor: Editor | null;
  /** Insert an HTML fragment at the caret (Clause Library, HTML placeholders). */
  insertHTML: (html: string) => void;
  /** Insert plain text + a trailing space at the caret (token placeholders). */
  insertText: (text: string) => void;
  /** Replace the whole document (DOCX upload, external re-seed). */
  setHTML: (html: string) => void;
}

/**
 * Repair links whose href is empty or protocol-only (e.g. href="https://") but
 * whose visible TEXT is a real URL. An old toolbar bug saved these when a user
 * link-wrapped a pasted URL and accepted the bare "https://" prompt default, so
 * the link opened nowhere — in the editor AND in the DOCX/PDF export. Rewriting
 * the href from the text makes the link openable everywhere, and (because the
 * editor emits the repaired HTML on the next save) permanently fixes the record.
 */
export function repairBrokenLinkHrefs(html: string): string {
  if (!html || html.indexOf('<a') === -1) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let changed = false;
    doc.querySelectorAll('a').forEach((a) => {
      const href = (a.getAttribute('href') || '').trim();
      const broken = href === '' || href === '#' || /^(https?:\/\/|mailto:|tel:)$/i.test(href);
      if (!broken) return;
      const text = (a.textContent || '').trim();
      if (!text || !/^(https?:\/\/|mailto:|tel:|www\.|[\w-]+(\.[\w-]+)+)/i.test(text)) return;
      a.setAttribute('href', /^(https?:\/\/|mailto:|tel:)/i.test(text) ? text : `https://${text}`);
      changed = true;
    });
    return changed ? doc.body.innerHTML : html;
  } catch {
    return html;
  }
}

export function useCtcEditor(opts: { value: string; onChange: (html: string) => void; editable?: boolean }): CtcEditor {
  const { value, onChange, editable = true } = opts;
  const lastSyncedRef = useRef<string>(value);
  const syncTimer = useRef<number | null>(null);

  const editor = useEditor({
    editable,
    extensions: [
      // StarterKit v3 BUNDLES link + underline, so configure link HERE (a second
      // Link extension would be a duplicate and its config ignored). autolink/
      // linkOnPaste OFF: they linkify any "word.word" text as a domain, which
      // turned every {{customer.name}} / {{customer.company}} placeholder into a
      // link. Manual links via the toolbar's 🔗 button still work.
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // autolink/linkOnPaste OFF + shouldAutoLink hard-returns false so NOTHING
        // is ever auto-linkified — placeholder tokens like {{customer.name}} were
        // being turned into links because ".name/.company/.email/.zip" are real
        // TLDs. Manual links via the toolbar 🔗 button still work.
        link: {
          // Manual links (toolbar 🔗) open in a NEW TAB when clicked so the
          // editor isn't navigated away. autolink/linkOnPaste stay OFF so
          // placeholder tokens like {{customer.name}} are never linkified.
          openOnClick: true,
          autolink: false,
          linkOnPaste: false,
          shouldAutoLink: () => false,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontSize,
      Color,
      BackgroundColor,
      Subscript,
      Superscript,
      // Tables — required by the Agreement / Trade Doc editors (Insert Table +
      // tables carried in from an uploaded DOCX). Harmless for CTC (no table
      // button in its toolbar). resizable off keeps the serialized HTML clean.
      StyledTable.configure({ resizable: false }),
      StyledTableRow,
      StyledTableHeader,
      StyledTableCell,
      ParagraphIndent,
      PageBreak,
      PageFlow,
    ],
    content: repairBrokenLinkHrefs(value) || '<p></p>',
    onUpdate({ editor }) {
      const html = editor.getHTML();
      lastSyncedRef.current = html;
      // Debounce the push to the parent so a long agreement doesn't re-render the
      // whole Stage tree on every keystroke; formatting itself stays instant.
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => onChange(html), 250);
    },
  });

  useEffect(() => () => { if (syncTimer.current) window.clearTimeout(syncTimer.current); }, []);
  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  // External value change (hydration / DOCX / reset) → re-seed without looping.
  useEffect(() => {
    if (!editor) return;
    if (value !== lastSyncedRef.current && value !== editor.getHTML()) {
      lastSyncedRef.current = value;
      editor.commands.setContent(repairBrokenLinkHrefs(value) || '<p></p>', { emitUpdate: false });
    }
  }, [value, editor]);

  return {
    editor,
    insertHTML: (html: string) => { editor?.chain().focus().insertContent(html).run(); },
    insertText: (text: string) => { editor?.chain().focus().insertContent(text + ' ').run(); },
    setHTML: (html: string) => {
      if (!editor) return;
      const repaired = repairBrokenLinkHrefs(html);
      lastSyncedRef.current = repaired;
      editor.commands.setContent(repaired || '<p></p>', { emitUpdate: false });
      onChange(repaired);
    },
  };
}

/** Content-area render — drop inside the HeaderFooterPanel (or any surface). */
/**
 * @param pageView  Lay the surface out as A4 pages, the way Word does.
 *   Without it the drafter types into an endless column and cannot tell where
 *   the PDF will split — they only find out after generating it. The geometry
 *   is taken from the PDF itself (see .ctcte-pageview) so the guides land where
 *   dompdf actually breaks.
 */
export function CtcEditorContent({ editor, pageView }: { editor: Editor | null; pageView?: boolean }) {
  if (!editor) return null;
  return <EditorContent editor={editor} className={`ctcte-content${pageView ? ' ctcte-pageview' : ''}`} />;
}

/** Formatting toolbar — render ABOVE the content surface. */
export function CtcToolbar({ editor, dark }: { editor: Editor | null; dark?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  if (!editor) return null;

  const applyLink = () => {
    const raw = linkUrl.trim();
    if (!raw) {
      // Empty → remove the link from the current selection.
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false); setLinkUrl('');
      return;
    }
    // Add a protocol so "www.x.com" / "x.com" become valid, openable hrefs.
    const url = /^(https?:\/\/|mailto:|tel:)/i.test(raw) ? raw : `https://${raw}`;
    const { from, to } = editor.state.selection;
    if (from === to) {
      // No text selected — insert the URL itself as clickable linked text so
      // the link actually shows in the draft instead of applying to nothing.
      editor.chain().focus()
        .insertContent(`<a href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${raw.replace(/</g, '&lt;')}</a> `)
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setLinkOpen(false); setLinkUrl('');
  };

  const headingValue = editor.isActive('heading', { level: 1 }) ? 'h1'
    : editor.isActive('heading', { level: 2 }) ? 'h2'
    : editor.isActive('heading', { level: 3 }) ? 'h3' : 'p';

  // Current font size (px number without unit) from the textStyle mark.
  const curFontSize = String(editor.getAttributes('textStyle').fontSize || '').replace('px', '');

  // Indent / outdent: nudge list nesting inside a list, else the block's
  // margin-left (the ParagraphIndent attribute) across the selection.
  const changeIndent = (delta: number) => {
    if (editor.isActive('listItem')) {
      const c = editor.chain().focus();
      (delta > 0 ? c.sinkListItem('listItem') : c.liftListItem('listItem')).run();
      return;
    }
    const { state, view } = editor;
    const { from, to } = state.selection;
    const tr = state.tr;
    let changed = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
      const cur = (node.attrs.indent as number) || 0;
      const next = Math.max(0, Math.min(INDENT_MAX, cur + delta));
      if (next !== cur) { tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next }); changed = true; }
    });
    if (changed) { view.dispatch(tr); editor.commands.focus(); }
  };

  return (
    <div className={`ctcte-toolbar ${dark ? 'ctcte-dark' : ''}`}>
      <select
        className="ctcte-sel"
        value={headingValue}
        onChange={e => {
          const v = e.target.value; const c = editor.chain().focus();
          if (v === 'p') c.setParagraph().run(); else c.toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}
        title="Block style"
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <select
        className="ctcte-sel ctcte-sel-sm"
        value={curFontSize}
        onChange={e => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(`${v}px`).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
        title="Font size"
      >
        <option value="">Size</option>
        {['10', '11', '12', '13', '14', '16', '18', '20', '24', '28', '32'].map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      <span className="ctcte-div" />
      <TB active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()}      title="Bold"><b>B</b></TB>
      <TB active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="Italic"><i>I</i></TB>
      <TB active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></TB>
      <TB active={editor.isActive('strike')}    onClick={() => editor.chain().focus().toggleStrike().run()}    title="Strikethrough"><s>S</s></TB>

      <span className="ctcte-div" />
      <TB active={editor.isActive({ textAlign: 'left' })}    onClick={() => editor.chain().focus().setTextAlign('left').run()}    title="Align left"><Ico d="M3 6h18M3 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'center' })}  onClick={() => editor.chain().focus().setTextAlign('center').run()}  title="Align center"><Ico d="M3 6h18M6 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'right' })}   onClick={() => editor.chain().focus().setTextAlign('right').run()}   title="Align right"><Ico d="M3 6h18M9 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify"><Ico d="M3 6h18M3 12h18M3 18h18" /></TB>

      <span className="ctcte-div" />
      <TB active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()}  title="Bullet list"><Ico d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></TB>
      <TB active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><Ico d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2" /></TB>
      <TB onClick={() => changeIndent(1)} title="Increase indent"><Ico d="M3 6h18M3 12h9M3 18h18M17 9l3 3-3 3" /></TB>
      <TB onClick={() => changeIndent(-1)} title="Decrease indent"><Ico d="M3 6h18M3 12h9M3 18h18M21 9l-3 3 3 3" /></TB>

      <span className="ctcte-div" />
      <div className="ctcte-linkwrap">
        <TB active={editor.isActive('link')} onClick={() => { setLinkUrl(editor.getAttributes('link').href ?? ''); setLinkOpen(o => !o); }} title="Insert link"><Ico d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></TB>
        {linkOpen && (
          <div className="ctcte-linkpop" onMouseDown={e => e.preventDefault()}>
            <input autoFocus className="ctcte-linkinput" placeholder="https://…" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') setLinkOpen(false); }} />
            <button type="button" className="ctcte-linkbtn" onClick={applyLink}>Apply</button>
          </div>
        )}
      </div>

      <span className="ctcte-div" />
      {/* Page break — the only EXACT control over where the PDF splits. The
          A4 guides on the surface are an estimate (browser and dompdf lay text
          out differently); this is a real instruction dompdf obeys. */}
      {/* Labelled, unlike every other button here. Icon-only was invisible in
          practice: it sat among a dozen formatting glyphs and read as one more
          alignment control, so nobody found it. This is a rare, deliberate
          action with no widely-known glyph — the word is what makes it
          findable. */}
      <button
        type="button"
        className="ctcte-pgbtn"
        title="Insert a page break — the PDF starts a new page from here"
        onMouseDown={e => e.preventDefault()}
        onClick={() => (editor.chain().focus() as any).setPageBreak().run()}
      >
        <Ico d="M3 5h18M3 19h18M4 12h3M10.5 12h3M17 12h3" />
        Page Break
      </button>

      <span className="ctcte-div" />
      <TB onClick={() => editor.chain().focus().undo().run()} title="Undo"><Ico d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" /></TB>
      <TB onClick={() => editor.chain().focus().redo().run()} title="Redo"><Ico d="M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8" /></TB>
    </div>
  );
}

function TB({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick} className={`ctcte-btn${active ? ' is-active' : ''}`}>{children}</button>;
}

function Ico({ d }: { d: string }) {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}</svg>;
}

/** Drop once inside the editor's stage (styles the toolbar + ProseMirror body). */
export const CTC_EDITOR_CSS = `
/* WRAP onto multiple rows so EVERY tool is visible (no horizontal scroll that
   hid the right-hand tools). row-gap keeps the rows cleanly separated and
   align-items:center lines the controls up so it doesn't read as ragged. */
.ctcte-toolbar { display: flex; align-items: center; gap: 3px; row-gap: 6px; flex-wrap: wrap; padding: 7px 10px; border-bottom: 1px solid #EDE9FE; background: #FAFBFF; flex-shrink: 0; }
.ctcte-toolbar > * { flex-shrink: 0; }
.ctcte-sel { height: 28px; border: 1.5px solid #E5E1F3; border-radius: 8px; background: #fff; color: #4C1D95; font-family: inherit; font-size: 11px; font-weight: 600; padding: 0 8px; cursor: pointer; outline: none; }
.ctcte-sel-sm { min-width: 56px; padding: 0 6px; }
/* ── A4 page view ──────────────────────────────────────────────────────────
   Every number is read off the PDF, not chosen for looks — a sheet edge here
   has to be where dompdf really breaks.

     config/dompdf.php : paper a4, dpi 96  ->  A4 = 794 x 1123 px
     blade @page       : margins 25 top / 25 sides / 92 bottom
       => printable area 744 x 1006 px                            (PAGE_H)
     blade .page-header: padding 20 + logo 62 + margin 12 = 94px, and it sits
       in the NORMAL flow, so it costs that height on sheet ONE only  (HEAD_H)
     blade body        : font-size 11px, line-height 15px

   No background gradient any more: the sheets are defined by the gaps PageFlow
   inserts, so there is exactly one source of truth for where a page ends. A
   gradient drawn independently would drift away from the real breaks. */
.ctcte-pageview { --pg-w: 744px; background: #EEF0F6; padding: 18px 0 26px; }
.ctcte-pageview .ProseMirror {
  width: var(--pg-w);
  margin: 0 auto;
  padding: 25px 25px 92px;
  box-sizing: content-box;
  /* Load-bearing: PageFlow reads child.offsetTop, which is relative to the
     nearest positioned ancestor. Without this it would measure from somewhere
     up in the page shell and every page boundary would land early. */
  position: relative;
  background: #fff;
  /* Same type metrics as the PDF body, so a line here is a line there. */
  font-size: 11px;
  line-height: 15px;
  box-shadow: 0 1px 3px rgba(16,24,40,.10), 0 8px 24px rgba(16,24,40,.06);
}
/* The band between two sheets. Negative margins cancel the ProseMirror padding
   so it spans the full width and reads as the sheet ENDING, not a grey box
   inside it. */
.ctcte-pagegap {
  position: relative;
  margin: 0 -25px;
  background: #EEF0F6;
  border-top: 1px solid #D3D8E3;
  border-bottom: 1px solid #D3D8E3;
  box-shadow: inset 0 7px 10px -9px rgba(16,24,40,.30), inset 0 -7px 10px -9px rgba(16,24,40,.30);
  user-select: none;
}
/* Labels pinned to the band's own edges, never to the middle — a short gap
   would otherwise stack them on top of each other. */
.ctcte-pagegap::before,
.ctcte-pagegap::after {
  position: absolute; left: 50%; transform: translateX(-50%);
  padding: 1px 9px; border-radius: 999px;
  background: #fff; border: 1px solid #DDD6FE; color: #6D28D9;
  font-size: 8.5px; font-weight: 800; letter-spacing: .08em; white-space: nowrap;
}
.ctcte-pagegap::before { content: 'END OF PAGE ' attr(data-from); top: -9px; }
.ctcte-pagegap::after  { content: 'PAGE ' attr(data-to);       bottom: -9px; }
[data-bs-theme="dark"] .ctcte-pageview { background: #12151c; }
[data-bs-theme="dark"] .ctcte-pageview .ProseMirror { background: #1b2028; color: #e5e7eb; }
[data-bs-theme="dark"] .ctcte-pagegap { background: #12151c; border-color: #2a3140; }

.ctcte-pgbtn { height: 26px; padding: 0 9px; border: 1.5px solid #DDD6FE; border-radius: 7px; background: #F5F3FF; color: #6D28D9; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; transition: background .12s, border-color .12s; }
.ctcte-pgbtn:hover { background: #EDE9FE; border-color: #C4B5FD; }
[data-bs-theme="dark"] .ctcte-pgbtn { background: rgba(124,58,237,.18); border-color: rgba(124,58,237,.45); color: #C4B5FD; }
.ctcte-div { width: 1px; height: 18px; background: #E5E1F3; margin: 0 3px; }
.ctcte-btn { min-width: 26px; height: 26px; padding: 0 6px; border: none; border-radius: 7px; background: none; color: #4C1D95; font-family: 'Georgia', serif; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .12s, color .12s; }
.ctcte-btn:hover { background: #EDE9FE; }
.ctcte-btn.is-active { background: linear-gradient(135deg,#6D28D9,#7C3AED); color: #fff; }
.ctcte-linkwrap { position: relative; display: inline-flex; }
.ctcte-linkpop { position: absolute; top: 32px; left: 0; z-index: 60; display: flex; gap: 6px; padding: 7px; background: #fff; border: 1.5px solid #DDD6FE; border-radius: 10px; box-shadow: 0 12px 30px rgba(109,40,217,.2); }
.ctcte-linkinput { width: 200px; height: 30px; border: 1.5px solid #E5E1F3; border-radius: 7px; padding: 0 9px; font-family: inherit; font-size: 12px; color: #1f2937; outline: none; }
.ctcte-linkinput:focus { border-color: #7C3AED; }
.ctcte-linkbtn { height: 30px; padding: 0 12px; border: none; border-radius: 7px; background: linear-gradient(135deg,#6D28D9,#7C3AED); color: #fff; font-family: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.ctcte-content { min-height: 220px; }
.ctcte-content .ProseMirror { min-height: 220px; padding: 14px 16px; outline: none; font-size: 12px; line-height: 1.8; color: #1f2937; }
.ctcte-content .ProseMirror p { margin: 0 0 .55em; }
.ctcte-content .ProseMirror h1 { font-size: 1.55em; font-weight: 800; margin: .5em 0 .35em; }
.ctcte-content .ProseMirror h2 { font-size: 1.3em; font-weight: 800; margin: .5em 0 .3em; }
.ctcte-content .ProseMirror h3 { font-size: 1.12em; font-weight: 700; margin: .45em 0 .28em; }
.ctcte-content .ProseMirror div.page-break {
  position: relative; height: 0; margin: 22px 0;
  border-top: 2px dashed #C4B5FD;
}
.ctcte-content .ProseMirror div.page-break::after {
  content: 'PAGE BREAK';
  position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
  padding: 1px 9px; border-radius: 999px;
  background: #F5F3FF; border: 1px solid #DDD6FE;
  color: #6D28D9; font-family: inherit; font-size: 9px; font-weight: 800; letter-spacing: .08em;
}
.ctcte-content .ProseMirror div.page-break.ProseMirror-selectednode { border-top-color: #6D28D9; }
.ctcte-content .ProseMirror ul, .ctcte-content .ProseMirror ol { padding-left: 1.4em; margin: 0 0 .55em; }
.ctcte-content .ProseMirror a { color: #6D28D9; text-decoration: underline; }
.ctcte-content .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #A78BFA; pointer-events: none; float: left; height: 0; }

[data-bs-theme="dark"] .ctcte-toolbar { background: rgba(255,255,255,.03); border-bottom-color: rgba(124,58,237,.2); }
[data-bs-theme="dark"] .ctcte-sel { background: rgba(255,255,255,.05); border-color: rgba(124,58,237,.3); color: #c4b5fd; }
[data-bs-theme="dark"] .ctcte-div { background: rgba(124,58,237,.3); }
[data-bs-theme="dark"] .ctcte-btn { color: #c4b5fd; }
[data-bs-theme="dark"] .ctcte-btn:hover { background: rgba(124,58,237,.18); }
[data-bs-theme="dark"] .ctcte-content .ProseMirror { color: #e8eaed; }
[data-bs-theme="dark"] .ctcte-linkpop { background: #1b2230; border-color: rgba(124,58,237,.35); }
[data-bs-theme="dark"] .ctcte-linkinput { background: rgba(255,255,255,.05); border-color: rgba(124,58,237,.3); color: #e8eaed; }
`;
