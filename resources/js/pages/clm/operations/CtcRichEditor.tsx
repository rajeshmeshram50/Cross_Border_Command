import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { Extension, Node } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, FontSize, FontFamily, Color, BackgroundColor } from '@tiptap/extension-text-style';
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
   Two different things happen at a page boundary, because two different things
   happen in the PDF:

     a block that FITS on a sheet but not on this one  → moved down, leaving the
       tail of the sheet blank. dompdf does the same, so the blank tail here is
       the blank tail in the PDF.
     a block TALLER than a whole sheet                 → left where it is, with
       the boundary drawn over it. The template sets .document-content { page-
       break-inside: auto }, so dompdf splits it at a line box and leaves no
       blank tail. Reserving space here would invent whitespace the PDF does
       not have; drawing nothing (the original behaviour) hid whole pages.

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
/* ── Measured against dompdf, not derived ────────────────────────────────
   These were computed from the @page rule — 1123 (A4 @96dpi) - 25 - 92 = 1006 —
   and that was wrong by 42px a page, about two lines. Rendering the template's
   own CSS through dompdf and binary-searching the page count gives the real
   numbers: a full page holds 964px of content, and page one 948px before the
   document header.
   dompdf's line boxes are also ~1.28x what a browser produces for the same
   unitless line-height, so 11px/1.5 is 16.5px here and 21.4px there — a 30%
   error on EVERY line, which no amount of box tuning could absorb. The page
   surface therefore states its line heights in px, at dompdf's scale. */
const PAGE_H   = 964;    // measured: full page content height
/* .page-header, measured off the blade rather than assumed:
     logo max-height 62 (header_config.logo_height default; the title block is
     shorter at ~38, and the cells are vertical-align:middle, so the logo sets
     the row) + padding 10 top + 10 bottom + margin-bottom 12 = 94.
   Only holds while the logo height is the default — a tenant who sets
   header_config.logo_height taller gets a taller header and one fewer line on
   page one. */
const HEAD_H   = 94;     // document header, in flow on page one only
const DOC_PAD  = 18;     // .document-content padding-top, page one only (measured 964-948)
const FIRST_H  = PAGE_H - HEAD_H - DOC_PAD;
/* No gutter between sheets. A grey strip is decoration — the PDF has nothing
   there, so drawing it both added space the output does not have and put a band
   under the boundary line that read as part of the document. The blank tail
   above the line is the only real thing, and that is the paper itself. */
/* Nothing is reserved between two sheets.
   A footer strip + desk + top margin were drawn in here so the draft would look
   like separate sheets. It reserved 178px at every boundary and painted over
   it — and any boundary whose reservation did not land left that painting on
   top of the text. The blank tail below is real (dompdf leaves it); this was
   not, so it is gone rather than patched. */
const PAGE_GAP = 0;
/* How much of a manual break's blank tail the draft actually draws. */
const MANUAL_TAIL_MAX = 90;
/* Runaway guard only. The measure below is one forced reflow followed by N
   cached reads — it does not write inside the loop, so it stays linear and a
   few thousand blocks are cheap. The old 400 was set as if each read cost a
   reflow, and an uploaded agreement clears 400 top-level blocks at around
   twenty pages, so real imports silently lost their page breaks entirely. */
const PAGINATE_MAX_BLOCKS = 12000;

/* Fired on the editor's root once a pagination pass has settled. An import is
   not "done" when the HTTP call returns — the browser still has to lay out the
   document and this pass still has to find the page boundaries. */
export const CTC_PAGINATED_EVENT = 'ctc-paginated';
/* detail: { pages } — emitted after every pass that changed something, so a
   caller can show the count climbing instead of an unmoving spinner. */
export const CTC_PAGINATING_EVENT = 'ctc-paginating';

/* Resolves when the page boundaries for the current document are on screen, so
   a caller can keep its spinner up instead of handing the user a document that
   then reflows under them. Resolves at once outside page view (nothing to
   wait for) and always resolves — a timeout never leaves a spinner stuck. */
export function waitForPagination(
  editor: Editor | null,
  onProgress?: (pages: number) => void,
  // A safety net, not the normal exit. At 12s this was firing FIRST on a large
  // import and releasing the caller mid-pagination.
  timeoutMs = 120000,
): Promise<void> {
  const dom = editor?.view?.dom as HTMLElement | undefined;
  if (!dom || !dom.closest('.ctcte-pageview')) return Promise.resolve();
  return new Promise<void>(resolve => {
    let t = 0;
    const tick = (e: Event) => onProgress?.((e as CustomEvent).detail?.pages ?? 0);
    const done = () => {
      window.clearTimeout(t);
      dom.removeEventListener(CTC_PAGINATING_EVENT, tick);
      resolve();
    };
    dom.addEventListener(CTC_PAGINATING_EVENT, tick);
    dom.addEventListener(CTC_PAGINATED_EVENT, done, { once: true });
    t = window.setTimeout(done, timeoutMs);
  });
}

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
          /* null, not '' — an empty string is a LEGAL signature (a document
             with no page breaks yet), so starting there let the very first pass
             match itself and declare the layout converged before it had
             measured anything. */
          let signature: string | null = null;
          let retries = 0;
          /* Retries are frame-cheap now (the count check below reads no
             geometry), so this can be generous — a 300-page layout needs many
             more than a dozen frames to finish. */
          const MEASURE_RETRIES = 240;

          const measure = () => {
            const dom = view.dom as HTMLElement;
            const settled = () => dom.dispatchEvent(new CustomEvent(CTC_PAGINATED_EVENT));
            if (!dom.isConnected || !dom.closest('.ctcte-pageview')) return;
            if (view.state.doc.childCount > PAGINATE_MAX_BLOCKS) { settled(); return; }

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
            const kids = Array.from(dom.children) as HTMLElement[];

            /* Readiness check FIRST, and deliberately without touching offsetTop
               or offsetHeight — reading either forces the browser to lay the
               whole document out. The DOM lags the model after a bulk replace,
               so on a 300-page import the early passes are all going to be
               rejected; making each rejected pass pay for a full layout is what
               turned the import into a visible grind.
               classList is free, so a retry now costs one frame and nothing else. */
            /* Both of PageFlow's OWN children have to be excluded here, not
               just the spacer. The absolutely-positioned mark overlay is a real
               child of .ProseMirror too, so once a single in-place boundary
               existed this count was permanently one too high, the readiness
               check never passed again, and pagination stopped dead — and with
               it settled(), so the import spinner sat out its whole timeout.
               That is the 2-3 minutes on a 4-5 page file: no work, just a wait. */
            const isOurs = (el: HTMLElement) =>
              el.classList.contains('ctcte-pagegap') || el.classList.contains('ctcte-spanmarks');

            let blocks = 0;
            for (const child of kids) if (!isOurs(child)) blocks += 1;
            if (blocks !== view.state.doc.childCount) {
              if (retries < MEASURE_RETRIES) { retries += 1; schedule(true); return; }
              // Out of retries: stop waiting on it, but never leave a caller
              // holding a spinner for something that is not going to arrive.
              settled();
              return;
            }
            retries = 0;

            const padTop = parseFloat(getComputedStyle(dom).paddingTop) || 0;

            /* ── Flow units ──────────────────────────────────────────────────
               A table is ONE top-level block, so a block-level pass can only
               count pages across it — it can never place a boundary inside it.
               An imported agreement is very often a single several-hundred-row
               table, which is why a whole upload could come back with no page
               break drawn anywhere.

               dompdf does split a table, at row boundaries. So rows are the
               correct unit here, and everything else stays a block.

               The spacer inside a table is a real <tr>, not the <div> used
               between blocks: a div is invalid inside <tbody> and the browser
               hoists it out of the table, taking the reserved height with it.
               Being a genuine sibling row also means it is measured and
               subtracted exactly like the block spacers, so the pass stays
               idempotent for the same reason. */
            const rowsOf = (el: HTMLElement): HTMLElement[] | null => {
              /* The table is not reliably a direct child, and its rows are not
                 reliably all in one <tbody>. `:scope > table` + `:scope > tbody`
                 missed both cases, rowsOf returned null, and the whole table
                 fell back to being ONE block — which is exactly how the page
                 counter jumps 2 → 5 with no band in between: a three-page table
                 counted as three pages and drew none of them.
                 querySelector('table') is tree order, so a nested table in a
                 cell can never win over its own outer table. */
              const table = (el.tagName === 'TABLE' ? el : el.querySelector('table')) as HTMLElement | null;
              if (!table) return null;
              const rows: HTMLElement[] = [];
              for (const sec of Array.from(table.children) as HTMLElement[]) {
                if (sec.tagName === 'TR') { rows.push(sec); continue; }
                if (sec.tagName === 'THEAD' || sec.tagName === 'TBODY' || sec.tagName === 'TFOOT') {
                  for (const r of Array.from(sec.children) as HTMLElement[]) {
                    if (r.tagName === 'TR') rows.push(r);
                  }
                }
              }
              return rows.length ? rows : null;
            };

            const docKids: { node: any; pos: number }[] = [];
            view.state.doc.forEach((node, offset) => docKids.push({ node, pos: offset }));

            // `phys` is offsetTop as rendered — .ProseMirror is position:relative,
            // so it is already the coordinate an absolutely placed marker needs.
            type Unit = { top: number; height: number; phys: number; pos: number; size: number; row: boolean; cols: number; brk: boolean };
            const units: Unit[] = [];
            let gapAcc = 0;
            let di = 0;
            for (const child of kids) {
              // The mark overlay is absolutely positioned — no flow height to
              // subtract, and not a document block either.
              if (child.classList.contains('ctcte-spanmarks')) continue;
              if (child.classList.contains('ctcte-pagegap')) { gapAcc += child.offsetHeight; continue; }
              /* A block carrying its own blank tail as padding. The padding is
                 INSIDE the element, so its border-box top is still the natural
                 position and only what follows is displaced — the same frame as
                 a spacer sibling, which is why it subtracts identically.
                 Base padding-top for p/h/div in the page view is 0, so the
                 computed value IS the reserved tail. */
              const own = child.classList.contains('ctcte-pgtop')
                ? (parseFloat(getComputedStyle(child).paddingTop) || 0) : 0;
              const dk = docKids[di++];
              if (!dk) break;

              const rows = dk.node.type.name === 'table' ? rowsOf(child) : null;
              const content = rows?.filter(r => !r.classList.contains('ctcte-pagegap-row'));
              /* Pair model rows to DOM rows by index, and require only that the
                 DOM has at least as many.
                 Demanding an EXACT match was too strict and it failed silently:
                 one extra <tr> anywhere — and rowsOf now also reads <thead> and
                 <tfoot> — dropped the whole table back to being one block. A
                 table two pages tall then ate two page boundaries and produced
                 the in-place dashes instead of proper gutters, which is why
                 boundaries appeared in two different designs.
                 rowsOf only collects direct section children of the outer table,
                 so a nested table's rows can never shift this alignment. */
              if (!rows || !content || content.length < dk.node.childCount) {
                units.push({
                  top: child.offsetTop - padTop - gapAcc, height: child.offsetHeight - own,
                  phys: child.offsetTop, pos: dk.pos, size: dk.node.nodeSize, row: false, cols: 0,
                  brk: dk.node.type.name === 'pageBreak',
                });
                gapAcc += own;
                continue;
              }

              let rp = dk.pos + 1;
              let ri = 0;
              for (const tr of rows) {
                if (tr.classList.contains('ctcte-pagegap-row')) { gapAcc += tr.offsetHeight; continue; }
                if (ri >= dk.node.childCount) break;
                const cols = (Array.from(tr.children) as HTMLTableCellElement[])
                  .reduce((n, c) => n + (c.colSpan || 1), 0);
                units.push({ top: tr.offsetTop - padTop - gapAcc, height: tr.offsetHeight, phys: tr.offsetTop, pos: rp, size: 0, row: true, cols, brk: false });
                rp += dk.node.child(ri++).nodeSize;
              }
            }

            /* Every block measuring zero means the browser has not laid the
               document out yet — NOT "nothing overflows a page". Without this
               the pass produced an empty decoration set, called that a converged
               layout, and released the import spinner onto a document whose page
               breaks had not been worked out at all. */
            const last = units[units.length - 1];
            if (units.length && last.top + last.height <= 0) {
              if (retries < MEASURE_RETRIES) { retries += 1; schedule(true); }
              return;
            }

            /* ── Boundaries, then numbers ─────────────────────────────────
               The page number used to be a counter incremented at each of four
               sites, and the label was read off it at the moment a band was
               drawn. Any site that advanced the counter without drawing
               anything silently ate a page number — which is how the labels
               could read PAGE 2 ENDS then PAGE 5 ENDS.

               So nothing is numbered during the walk. Every boundary is
               COLLECTED, in document order, and numbered 1..N afterwards. A
               skipped number is then not a bug to hunt, it is unrepresentable:
               a boundary either exists in this list and gets the next number,
               or it does not exist at all.

               Every boundary also gets a mark. Where the PDF pushes content
               down (a block that fits on a sheet, just not this one) that mark
               is a spacer band. Where the PDF splits in place (a block taller
               than a sheet, page-break-inside:auto) it is a line drawn over the
               content, reserving nothing. */
            /* `pad` is the ordinary case and deliberately not a widget.
               A widget means a DOM node created and destroyed on every pass —
               and the page number is part of its key, so ordinary typing churned
               every band in the document. Insert-and-remove under a scrolling,
               clipped, fixed shell is what leaves Chrome painting stale tiles,
               i.e. the doubled text. A node decoration touches no DOM at all
               when nothing changed, and when something does it is one inline
               style on an element that was already there. */
            type Bound =
              | { kind: 'pad'; from: number; to: number; fill: number; line: number }
              | { kind: 'band'; at: number; key: string; h: number; row: boolean; cols: number; line: number; silent?: boolean }
              | { kind: 'mark'; line: number };
            const bounds: Bound[] = [];
            let cap = FIRST_H;   // natural height available through this sheet

            for (const u of units) {
              /* An explicit Page Break ends the sheet HERE, however much room is
                 left. PageFlow used to ignore the node entirely and keep filling
                 the same sheet, so every automatic band after a manual break was
                 measured against a page that had already ended. */
              if (u.brk) {
                const bottom = u.top + u.height;
                const fill = Math.round(cap - bottom);
                /* A manual break ALWAYS ends its page — that is the point of
                   the button. It used to fall through to a bare marker whenever
                   it landed with no room left, which said the opposite of what
                   the user had just asked for. */
                const room = Math.max(0, fill);
                /* The blank tail after a MANUAL break is shown collapsed.
                   It is real — the PDF leaves it — but it is dead space the
                   user deliberately created, and rendering all of it made them
                   scroll through half a page of nothing.
                   Safe to shorten because the page maths never reads this
                   height: natural positions come from the DOM (gapAcc measures
                   whatever is actually reserved) and `cap` advances by the TRUE
                   room below. So the numbering and every later boundary stay
                   exactly where the PDF puts them. Automatic breaks are left
                   alone — their tails are what the PDF genuinely chose. */
                const shown = Math.min(room, MANUAL_TAIL_MAX);
                /* silent: the node draws its own PAGE BREAK marker right here,
                   so an automatic "PAGE n ENDS" on the same boundary was a
                   second label for one event. It still takes its page number —
                   it is a real boundary — it just isn't drawn twice. */
                bounds.push({ kind: 'band', at: u.pos + u.size, key: `pb${u.pos}`,
                              h: shown + PAGE_GAP, row: false, cols: 0, silent: true,
                              line: u.phys + u.height + shown });
                cap = bottom + room + PAGE_H;
                continue;
              }

              /* ── A block that fits on a sheet, but not on THIS one ────
                 …is pushed down whole, leaving the tail of the sheet blank.

                 This was removed on the reasoning that .document-content is
                 page-break-inside:auto, so dompdf must be splitting the block
                 at a line box instead. That reasoning was wrong, and rendering
                 the template through dompdf settles it: twenty 4-line
                 paragraphs fit in two pages, not twenty-two. dompdf moves the
                 whole block. The blank tail is real, and it is the gap that
                 shows up above the footer in the generated PDF. */
              if (u.height <= PAGE_H && u.top + u.height > cap) {
                /* fill can legitimately be 0 — the sheet ended exactly at this
                   block's edge. There is no blank tail, but the footer strip,
                   the gutter and the next sheet's top margin are still there,
                   so space is still reserved and this still draws as a real
                   sheet break. It used to fall through to a bare line labelled
                   "PAGE n ENDS" with nothing ending after it. */
                const fill = Math.round(cap - u.top);
                const room = Math.max(0, fill);
                const line = u.phys + room;
                bounds.push(u.row
                  ? { kind: 'band', at: u.pos, key: `pg${u.pos}`, h: room + PAGE_GAP, row: true, cols: u.cols, line }
                  : { kind: 'pad', from: u.pos, to: u.pos + u.size, fill: room, line });
                cap = u.top + PAGE_H;
              }

              /* Taller than a whole sheet, so it cannot be pushed anywhere —
                 dompdf has to break it in place, and so do we. */
              while (u.top + u.height > cap) {
                bounds.push({ kind: 'mark', line: u.phys + (cap - u.top) });
                cap += PAGE_H;
              }
            }

            const decos: Decoration[] = [];
            const sigParts: string[] = [];
            // EVERY boundary is drawn, whatever it also reserves.
            const marks = bounds
              .map((b, i) => ({
                top: b.line, page: i + 1,
                // An in-place split reserves nothing, so only a hairline fits.
                sheet: b.kind !== 'mark',
                silent: b.kind === 'band' && b.silent === true,
              }))
              .filter(m => !m.silent);

            bounds.forEach((b, i) => {
              const from = i + 1;
              if (b.kind === 'pad') {
                sigParts.push(`p${b.from}:${b.fill}:${from}`);
                decos.push(Decoration.node(b.from, b.to, {
                  class: 'ctcte-pgtop',
                  // Blank tail, then footer strip + gutter + next top margin.
                  style: `--pg-fill:${b.fill}px; --pg-pad:${b.fill + PAGE_GAP}px`,
                  'data-from': String(from),
                }));
                return;
              }
              if (b.kind !== 'band') return;
              sigParts.push(`${b.key}:${b.h}:${from}`);
              decos.push(Decoration.widget(b.at, () => {
                if (!b.row) {
                  const gap = document.createElement('div');
                  gap.className = 'ctcte-pagegap';
                  gap.style.height = `${b.h}px`;
                  gap.style.setProperty('--pg-fill', `${b.h - PAGE_GAP}px`);
                  gap.setAttribute('data-from', String(from));
                  gap.contentEditable = 'false';
                  return gap;
                }
                const gap = document.createElement('tr');
                gap.className = 'ctcte-pagegap-row';
                gap.contentEditable = 'false';
                const cell = document.createElement('td');
                cell.colSpan = Math.max(1, b.cols);
                cell.style.height = `${b.h}px`;
                cell.style.setProperty('--pg-fill', `${b.h - PAGE_GAP}px`);
                cell.setAttribute('data-from', String(from));
                gap.appendChild(cell);
                return gap;
              }, { side: -1, key: `${b.key}#${from}` }));
            });

            /* All in-place boundaries ride in ONE absolutely-positioned widget
               at the top of the document. Absolute means zero flow impact — no
               reflow, no caret jump, no re-measure cascade. */
            if (marks.length) {
              const marksSig = marks.map(m => `${Math.round(m.top)}/${m.page}/${m.sheet ? 1 : 0}`).join('.');
              sigParts.push('m' + marksSig);
              decos.push(Decoration.widget(0, () => {
                const wrap = document.createElement('div');
                wrap.className = 'ctcte-spanmarks';
                wrap.contentEditable = 'false';
                for (const m of marks) {
                  const line = document.createElement('div');
                  line.className = m.sheet ? 'ctcte-pageline' : 'ctcte-spanmark';
                  line.style.top = `${Math.round(m.top)}px`;
                  line.setAttribute('data-page', String(m.page));
                  line.setAttribute('data-of', String(marks.length + 1));
                  wrap.appendChild(line);
                }
                return wrap;
                              /* The key has to encode the marks. A constant key told
                   ProseMirror the widget had not changed, so it reused the DOM
                   and never called toDOM again — the breaks stayed frozen at
                   positions measured BEFORE any page padding was applied. */
              }, { side: -1, key: 'spans:' + marksSig }));
            }

            /* Dispatch only on a real change, or each pass would trigger the
               next. An unchanged signature is also the ONLY honest definition of
               "the pages have stopped moving": inserting the spacers reflows the
               document, so the pass that inserts them cannot know whether that
               reflow pushed anything further along. Only the pass that finds
               nothing left to do can say the layout has converged — that is what
               the waiting spinner is holding out for. */
            const sig = sigParts.join(',');
            if (sig === signature) { settled(); return; }
            signature = sig;
            dom.dispatchEvent(new CustomEvent(CTC_PAGINATING_EVENT, { detail: { pages: bounds.length + 1 } }));
            /* Follow the caret across the reflow — but ONLY when it has
               actually been pushed out of sight.
               Scrolling on every pass was wrong twice over. A pass runs two or
               three times per edit, so the view was being scrolled repeatedly
               while PageFlow was still changing the content height — and a
               scroll concurrent with a height change is exactly the pairing
               that makes Chrome reuse stale tiles, which is the doubled text.
               So it self-inflicted the very artefact it was meant to help with,
               and made typing feel like it was fighting back. */
            const tr = view.state.tr
              .setMeta(pageFlowKey, DecorationSet.create(view.state.doc, decos))
              .setMeta('addToHistory', false);

            let chase = false;
            if (view.hasFocus()) {
              const scroller = dom.closest('.ctc-mid-scroll') as HTMLElement | null;
              try {
                const c = view.coordsAtPos(view.state.selection.head);
                const box = (scroller ?? dom).getBoundingClientRect();
                chase = c.top < box.top + 8 || c.bottom > box.bottom - 8;
              } catch { chase = false; }
            }
            view.dispatch(chase ? tr.scrollIntoView() : tr);
            // Confirm on the very next frame instead of behind the typing
            // debounce — the confirmation pass is what releases the spinner.
            schedule(true);
          };

          /* A pass costs one forced layout, so on a 300-page import it is worth
             real milliseconds. Keep it snappy on ordinary drafts and let it
             breathe on the huge ones, where re-measuring every 160ms while
             typing is what makes the editor feel like it is stuttering. */
          const schedule = (immediate = false) => {
            const delay = immediate ? 0 : (view.state.doc.childCount > 1200 ? 600 : 160);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(measure);
            }, delay);
          };

          schedule();
          /* The first pass runs in the fallback face while the PDF font is still
             downloading, so every line measured there is the wrong width. Redo
             it once the real font is in. */
          (document as any).fonts?.ready?.then(() => schedule(true));
          return {
            /* Wrapped, not passed straight through. ProseMirror calls this as
               update(view, prevState), so handing it `schedule` directly fed the
               EditorView object into the `immediate` parameter — always truthy,
               so the debounce collapsed to 0ms and every keystroke ran a full
               measure of the whole document. */
            update: () => schedule(),
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

/* Line spacing — the Word "Line and Paragraph Spacing" control.
 *
 * TipTap ships no line-height extension, so this is the same shape as
 * ParagraphIndent above: a global attribute on the block nodes, written out as
 * an inline style. Inline style rather than a class because the value has to
 * survive the round trip through the DOCX/PDF exporters, which read the
 * serialized HTML and understand `line-height` but know nothing about our
 * class names.
 *
 * Applied per BLOCK, not to a text selection: spacing is a property of a
 * paragraph, and half a paragraph at 1.5 and half at 1.0 is not a thing Word
 * can express either. Selecting across several paragraphs sets all of them.
 */
/* One font: Times New Roman.
 *
 * The agreement is set in it, so anything else on offer is a way to make a
 * clause not match the rest of the document. The list used to hold fourteen
 * faces; a draft is not a place to pick a typeface.
 *
 * The control is kept rather than removed because it still does something:
 * text that arrived carrying its own font — pasted from a browser, or from a
 * DOCX written before the upload strip existed — can be put back on the house
 * face by selecting it and choosing this. The uploader strips font-family on
 * the way in (ClmCtcForm's uploadDocx) and the page surface sets Times New
 * Roman as the default, so typing and uploading both land here already.
 *
 * The stack ends in a generic serif so dompdf resolves it to its built-in
 * times metrics, and a machine without the face falls back to a serif rather
 * than to the app's sans. */
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
];

/**
 * The font list for editors that ARE allowed a choice — currently only Terms &
 * Conditions, whose clauses are dropped into third-party paperwork that may be
 * set in something other than the house face.
 *
 * The agreement editors deliberately do NOT get this: a clause in a different
 * typeface from the rest of the contract is a defect, not an option.
 *
 * Every value ends in a generic (serif / sans-serif) because dompdf ships only
 * Times, Helvetica, Courier and the DejaVu family — Georgia and Cambria will
 * render AS a serif in the PDF rather than as themselves. Arial and Times New
 * Roman are the two that come out exactly.
 */
export const TNC_FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Arial',           value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri',         value: "Calibri, 'Segoe UI', sans-serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Georgia',         value: 'Georgia, serif' },
  { label: 'Cambria',         value: 'Cambria, Georgia, serif' },
];

/* Sizes in POINTS, not pixels. A legal draft is specified in pt (12pt body,
 * 14pt headings) and that is the unit the printed/PDF page is measured in —
 * px only ever matched on screen. Values are the ones Word offers. */
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36'];

/* Insert Table writes its borders INLINE rather than relying on a stylesheet.
 *
 * The PDF deliberately forces no cell border (see clm-signature-document
 * .blade.php): a bordered table has to carry its border in the markup so that
 * clause / layout tables — the borderless ones a DOCX upload brings in — stay
 * clean in the output. The editor follows the same rule, which is why a table
 * inserted with the plain insertTable() command appeared to do nothing: it was
 * there, three empty rows of it, with nothing drawn.
 *
 * Building the HTML here instead of calling insertTable() is what lets the
 * styles be part of the node from the first render. StyledTable / -Row / -Cell
 * preserve the `style` attribute, so it survives the save and the export. */
const TBL_BORDER = '1px solid #94A3B8';
function buildTableHTML(rows: number, cols: number): string {
  const th = `<th style="border:${TBL_BORDER};padding:6px 8px;background:#EEF2F7;vertical-align:top;text-align:left"><p></p></th>`;
  const td = `<td style="border:${TBL_BORDER};padding:6px 8px;vertical-align:top"><p></p></td>`;
  const head = `<tr>${th.repeat(cols)}</tr>`;
  const body = `<tr>${td.repeat(cols)}</tr>`.repeat(Math.max(0, rows - 1));
  return `<table style="width:100%;table-layout:fixed;border-collapse:collapse"><tbody>${head}${body}</tbody></table><p></p>`;
}

/* Row height.
 *
 * prosemirror-tables ships columnResizing and nothing for rows, so the
 * horizontal border cannot be dragged the way the vertical one can. Word's own
 * fallback is the same thing this is: a height set on the row, with the row
 * still free to GROW past it when the text needs more space.
 *
 * Written as a min-height on the row's own style attribute (StyledTableRow
 * keeps `style`), because a plain `height` on a table row is treated as a
 * minimum by every renderer anyway — including dompdf — and saying min-height
 * makes that explicit rather than implied. */
const ROW_HEIGHTS: { label: string; value: string | null }[] = [
  { label: 'Auto (fit text)', value: null },
  { label: 'Short',  value: '28px' },
  { label: 'Medium', value: '40px' },
  { label: 'Tall',   value: '56px' },
];

/** Replace (or drop) min-height inside an existing inline style string. */
function withRowHeight(style: string | null | undefined, height: string | null): string | null {
  const kept = String(style || '')
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !/^min-height\s*:/i.test(d) && !/^height\s*:/i.test(d));
  if (height) kept.push(`min-height: ${height}`);
  return kept.length ? kept.join('; ') : null;
}

/* Cell borders.
 *
 * The PDF forces no border on cells by design (clm-signature-document.blade
 * .php), so a bordered table has to say so in its own markup — which means
 * turning borders on or off is an edit to each cell's inline style, not a
 * class toggle. Insert Table already writes them; these let an existing table
 * — including one that arrived from a DOCX with no borders at all — be
 * changed after the fact. */
type BorderSpec = 'all' | 'bottom' | 'none';

/** Rewrite the border declarations inside one inline style string. */
function withBorders(style: string | null | undefined, spec: BorderSpec): string | null {
  const kept = String(style || '')
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !/^border(-top|-right|-bottom|-left)?\s*:/i.test(d));
  if (spec === 'all')    kept.push(`border: ${TBL_BORDER}`);
  if (spec === 'bottom') kept.push(`border-bottom: ${TBL_BORDER}`);
  return kept.length ? kept.join('; ') : null;
}

const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5', '3'];
/* What "Add Space Before/After Paragraph" adds. Word uses 10pt; the editor
 * works in px, and 10pt is 13.33px. */
const PARA_SPACE = '13px';

const LineHeight = Extension.create({
  name: 'lineHeight',
  addOptions() { return { types: ['paragraph', 'heading'] as string[] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
          renderHTML: (attributes: { lineHeight?: string | null }) =>
            attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
        },
        /* Word's menu carries three separate things and so does this: the line
         * spacing above, plus space BEFORE and space AFTER the paragraph.
         * They are different properties — line spacing is the gap between the
         * lines INSIDE one paragraph, these two are the gap between one
         * paragraph and the next — which is why setting 1.5 never moved the
         * paragraphs apart and looked like it had not worked. */
        spaceBefore: {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.marginTop || null,
          renderHTML: (attributes: { spaceBefore?: string | null }) =>
            attributes.spaceBefore ? { style: `margin-top: ${attributes.spaceBefore}` } : {},
        },
        spaceAfter: {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.marginBottom || null,
          renderHTML: (attributes: { spaceAfter?: string | null }) =>
            attributes.spaceAfter ? { style: `margin-bottom: ${attributes.spaceAfter}` } : {},
        },
      },
    }];
  },
  addCommands() {
    /* Applied to EVERY block type in one chain, so a selection spanning a
     * heading and two paragraphs is set in a single undo step. */
    const each = (types: string[], fn: (c: any, t: string) => any) =>
      ({ chain }: any) => types.reduce((c: any, t: string) => fn(c, t), chain()).run();

    return {
      setLineHeight: (value: string) =>
        each(this.options.types, (c, t) => c.updateAttributes(t, { lineHeight: value })),
      unsetLineHeight: () =>
        each(this.options.types, (c, t) => c.resetAttributes(t, ['lineHeight'])),
      setSpaceBefore: (value: string | null) =>
        each(this.options.types, (c, t) => c.updateAttributes(t, { spaceBefore: value })),
      setSpaceAfter: (value: string | null) =>
        each(this.options.types, (c, t) => c.updateAttributes(t, { spaceAfter: value })),
    } as any;
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
/* Keep every table's columns fully specified and inside the sheet.
 *
 * Two things prosemirror-tables does not do, and both of them showed up as the
 * editor and the PDF preview disagreeing:
 *
 *   1. A drag only records widths for the columns beside the handle. The rest
 *      stay null and serialize with no width, so anything reading the HTML
 *      sees a partial picture and lays the table out its own way.
 *   2. Nothing bounds the total, because nothing in it knows how wide the
 *      paper is — so widening a column pushed the table off the right margin.
 *
 * This fills in every column and rescales the set to the page. Same ratios the
 * author dragged; a complete, bounded set of numbers to serialize.
 *
 * 694px is this editor's text column: 794 (A4 at 96dpi) less the two @page
 * margins and the 50px the PDF's own wrappers add — the same arithmetic the
 * .ctcte-pageview rule below is built on. Keep the two in step.
 *
 * The ratios the author dragged are preserved; only the total is brought back
 * to the page. A floor of 30px stops a column being crushed to nothing, which
 * is the other half of the same problem.
 *
 * The PDF does not need this — the blade converts these widths to percentages
 * of the table, so they always sum to 100 there. This is the editor catching
 * up with what the page can actually hold. */
const PAGE_CONTENT_W = 694;
const MIN_COL_W = 30;

const TableFit = Extension.create({
  name: 'tableFit',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableFit'),
        appendTransaction(trs, _old, newState) {
          if (!trs.some(t => t.docChanged)) return null;

          let tr = newState.tr;
          let changed = false;

          newState.doc.descendants((table, pos) => {
            if (table.type.name !== 'table') return true;
            const firstRow = table.firstChild;
            if (!firstRow) return false;

            /* ── Read the current per-column widths ──────────────────────────
               prosemirror-tables only writes colwidth for the columns either
               side of the handle you dragged; the rest stay null. TipTap then
               serializes those as a bare min-width with no width at all, so the
               PDF had widths for two columns and nothing for the third — it
               sized the two it knew and squeezed the rest, which is why the
               editor and the preview disagreed while both "had" the widths.
               Every column gets a real number here, so what is serialized is
               the whole picture. */
            const cols: number[] = [];
            firstRow.forEach(cell => {
              const span = cell.attrs.colspan || 1;
              const cw = cell.attrs.colwidth;
              for (let i = 0; i < span; i++) cols.push(Array.isArray(cw) ? (cw[i] || 0) : 0);
            });
            if (!cols.length) return false;

            const knownTotal = cols.reduce((a, b) => a + b, 0);
            const missing = cols.filter(w => !w).length;

            /* Untouched columns share whatever the page has left over; if the
               drag already used it all they fall back to the floor. */
            const spare = Math.max(0, PAGE_CONTENT_W - knownTotal);
            const share = missing ? Math.max(MIN_COL_W, Math.floor(spare / missing)) : 0;
            const filled = cols.map(w => (w ? w : share));

            /* Then bring the total back to the page, keeping the ratios. This
               is also what stops a drag pushing the table off the sheet. */
            const total = filled.reduce((a, b) => a + b, 0);
            const factor = total > 0 ? PAGE_CONTENT_W / total : 1;
            const final = filled.map(w => Math.max(MIN_COL_W, Math.round(w * factor)));

            /* Write back, but only where a value actually differs — an
               unconditional setNodeMarkup would re-fire this plugin forever. */
            table.forEach((row, rowOff) => {
              const rowPos = pos + 1 + rowOff;
              let col = 0;
              row.forEach((cell, cellOff) => {
                const span = cell.attrs.colspan || 1;
                const next = final.slice(col, col + span);
                col += span;
                const cur = cell.attrs.colwidth;
                const same = Array.isArray(cur)
                  && cur.length === next.length
                  && cur.every((v: number, i: number) => v === next[i]);
                if (same) return;
                tr = tr.setNodeMarkup(rowPos + 1 + cellOff, undefined, { ...cell.attrs, colwidth: next });
                changed = true;
              });
            });

            return false;   // no tables inside tables
          });

          return changed ? tr : null;
        },
      }),
    ];
  },
});

/* Sub points — the multi-level clause numbering an agreement is written in:
 *
 *     1.  Purpose
 *     1.1   The Seller shall ...
 *     1.1.1   ... including
 *
 * A plain nested <ol> cannot do this. Its levels number independently, so the
 * second level restarts at 1 instead of continuing its parent as 1.1 — which
 * is the whole point of clause numbering, because clauses are cross-referenced
 * by that number.
 *
 * Built on CSS counters rather than by writing the numbers into the text: the
 * numbers then renumber themselves when a clause is inserted or deleted, which
 * hand-typed ones do not. dompdf implements counters() (see
 * vendor/dompdf/dompdf/src/Css/Content/Counters.php), so the same rule works
 * in the PDF — the matching CSS lives in clm-signature-document.blade.php and
 * the two have to stay in step.
 *
 * The flag sits on the OUTER list only; the nested ones are picked up by the
 * descendant selector, so Tab-ing a new level in needs no extra bookkeeping. */
const LegalList = Extension.create({
  name: 'legalList',
  addGlobalAttributes() {
    return [{
      types: ['orderedList'],
      attributes: {
        legal: {
          default: null,
          parseHTML: (el: HTMLElement) => (el.getAttribute('data-legal') ? '1' : null),
          renderHTML: (attrs: { legal?: string | null }) => (attrs.legal ? { 'data-legal': '1' } : {}),
        },
      },
    }];
  },
});

/* Find and Replace.
 *
 * TipTap ships no search extension (the official one is paid), so this is the
 * whole thing: a plugin that finds every match and decorates it, plus commands
 * to step through them and rewrite them.
 *
 * Matching is done per TEXT BLOCK, not per text node. A text node ends
 * wherever a mark starts, so "Agreement" with only "Agree" in bold is two
 * nodes — searching node by node would never find it. Walking the block and
 * building a char→position map finds it and still lands on the right document
 * positions, including when the block also holds non-text inline nodes (a page
 * break, a hard break) which occupy a position but contribute no text.
 */
const findKey = new PluginKey('findReplace');

type FindMatch = { from: number; to: number };
type FindState = { term: string; matchCase: boolean; matches: FindMatch[]; index: number };

function collectMatches(doc: any, term: string, matchCase: boolean): FindMatch[] {
  const out: FindMatch[] = [];
  if (!term) return out;
  const needle = matchCase ? term : term.toLowerCase();

  doc.descendants((node: any, pos: number) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child: any, offset: number) => {
      if (!child.isText) return;
      const start = pos + 1 + offset;
      for (let i = 0; i < child.text.length; i++) map.push(start + i);
      text += child.text;
    });
    const hay = matchCase ? text : text.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1) {
      out.push({ from: map[at], to: map[at + needle.length - 1] + 1 });
      at = hay.indexOf(needle, at + needle.length);
    }
    return false;   // a textblock holds no further textblocks
  });
  return out;
}

const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: (): FindState => ({ term: '', matchCase: false, matches: [], index: 0 }),
          apply(tr, prev: FindState): FindState {
            const meta = tr.getMeta(findKey);
            let next: FindState = meta ? { ...prev, ...meta } : prev;

            /* The matches normally arrive WITH the search, computed by the
               toolbar against the live document (see pushSearch). Carrying them
               rather than recomputing here is what keeps the highlights and the
               1/61 counter describing the same set — they were computed in two
               places and could disagree, which is how a search could count 61
               matches and draw none of them.
               A plain document edit brings no meta, so the set is refreshed
               from the term instead; without that a highlight would keep
               pointing at text that has since moved. */
            if (tr.docChanged && !meta) {
              next = { ...next, matches: collectMatches(tr.doc, next.term, next.matchCase) };
            }
            if (!next.term) return { ...next, matches: [], index: 0 };

            const index = next.matches.length ? Math.min(next.index, next.matches.length - 1) : 0;
            return { ...next, index };
          },
        },
        props: {
          decorations(state) {
            const fs: FindState = findKey.getState(state);
            if (!fs?.matches.length) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              fs.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, { class: i === fs.index ? 'ctcte-find-cur' : 'ctcte-find-hit' })),
            );
          },
        },
      }),
    ];
  },
});

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

/**
 * The 1,000,000-character ceiling, enforced on the way IN.
 *
 * Past it the PDF and Word exports are dead — dompdf and PhpWord do not fail
 * gracefully on a document that size, they take the request down. So the limit
 * was already checked on DOCX upload, and shown by the counter under every
 * editor. Neither of those covers a paste: someone could drop five megabytes of
 * text in, watch the counter turn red, and save it anyway.
 *
 * A paste is the only realistic way to cross a million characters by hand —
 * typing cannot — so paste and drop are the two events guarded. Typing is left
 * alone deliberately: checking every keystroke would mean serialising the whole
 * document on each one, and it cannot cross the line a character at a time.
 *
 * The message is not shown from here. The extension reports to whoever
 * configured it, so each editor raises it through its own toast rather than
 * this file inventing a second notification style.
 */
export const CONTENT_MAX_CHARS = 1000000;

type ContentLimitOptions = {
  max: number;
  onExceed?: (attempted: number, max: number) => void;
};

/* How much a paste will actually ADD to the document.
 *
 * `clipboardData.getData('text/html')` is not the content — it is the content
 * inside a transport envelope the browser builds, and the envelope is discarded
 * the moment ProseMirror parses it. Chrome prepends a <meta charset>, wraps the
 * selection in <html><body> with StartFragment/EndFragment comments, and — when
 * the copy came from another ProseMirror editor, which is exactly the
 * Agreement-to-Trade-Document case — stamps a data-pm-slice attribute on the
 * wrapper.
 *
 * Measuring the raw string counted all of that. So the same content reported
 * one length in the editor it was copied from and a larger one on arrival, and
 * a document at the ceiling could be refused over characters that were never
 * going to be stored. Stripping the envelope first makes the number describe
 * the document rather than the clipboard.
 *
 * Deliberately string-level, not a DOMParser pass: this runs on a payload up to
 * a megabyte during a paste, and building a second document to measure the
 * first would cost more than the guard saves. */
export const pastedLength = (raw: string): number => {
  if (!raw) return 0;
  return raw
    .replace(/<\/?(?:html|body|head)(?:\s[^>]*)?>/gi, '')  // transport wrapper
    .replace(/<meta[^>]*>/gi, '')                          // Chrome's charset tag
    .replace(/<!--\s*(?:Start|End)Fragment\s*-->/gi, '')   // Chrome's fragment marks
    .replace(/\sdata-pm-slice="[^"]*"/gi, '')              // ProseMirror slice info
    .trim()
    .length;
};

const ContentLimit = Extension.create<ContentLimitOptions>({
  name: 'contentLimit',
  addOptions() {
    return { max: CONTENT_MAX_CHARS, onExceed: undefined };
  },
  /* The document's HTML length, cached.
     getHTML() serialises the whole document, so it cannot be called on every
     keystroke of a million-character draft. It is already called once per
     update by the editors' own onChange, so the number is taken from there and
     reused — the guard costs nothing per key. */
  addStorage() {
    return { htmlLen: 0, lastWarn: 0 };
  },
  onCreate() { this.storage.htmlLen = this.editor.getHTML()?.length ?? 0; },
  onUpdate() { this.storage.htmlLen = this.editor.getHTML()?.length ?? 0; },
  addProseMirrorPlugins() {
    const { max, onExceed } = this.options;
    const editor = this.editor;
    const storage = this.storage;

    /* One message per two seconds. Typing at the ceiling fires the guard on
       every key, and a toast per keystroke is worse than the thing it warns
       about. */
    const warn = (attempted: number) => {
      const now = Date.now();
      if (now - storage.lastWarn < 2000) return;
      storage.lastWarn = now;
      onExceed?.(attempted, max);
    };

    /* True = block. Measured against getHTML() so the number matches the
       counter on screen, not a different idea of "length" that would reject at
       a figure the user never saw. */
    const wouldOverflow = (incoming: number): boolean => {
      const attempted = (editor.getHTML()?.length ?? 0) + incoming;
      if (attempted <= max) return false;
      warn(attempted);
      return true;
    };

    /* At or past the ceiling, nothing more goes in. Uses the CACHED length —
       see addStorage. */
    const atCeiling = (incoming: number): boolean => {
      const attempted = storage.htmlLen + incoming;
      if (attempted <= max) return false;
      warn(attempted);
      return true;
    };

    return [
      new Plugin({
        key: new PluginKey('contentLimit'),
        props: {
          handlePaste(_view, event) {
            const cd = (event as ClipboardEvent).clipboardData;
            const len = pastedLength(cd?.getData('text/html') || cd?.getData('text/plain') || '');
            return wouldOverflow(len);
          },
          handleDrop(_view, event) {
            const dt = (event as DragEvent).dataTransfer;
            const len = pastedLength(dt?.getData('text/html') || dt?.getData('text/plain') || '');
            return wouldOverflow(len);
          },
          /* Typing. A document sitting just under the ceiling walks past it one
             character at a time, which is exactly how a draft reached
             1,000,043 — the paste guard alone was never going to catch that.
             handleTextInput and handleKeyDown are USER-input hooks: they never
             fire for setContent, so hydrating a document that is already at the
             limit still works. A filterTransaction guard would have blocked
             that too and left the editor blank. */
          handleTextInput(_view, _from, _to, text) {
            return atCeiling(text.length);
          },
          handleKeyDown(_view, event) {
            // Enter opens a new block — a few characters of HTML, not one.
            if (event.key !== 'Enter') return false;
            return atCeiling(8);
          },
        },
      }),
    ];
  },
});

/**
 * The extension set behind the CLM editors.
 *
 * Exported because the toolbar (CtcToolbar) is only as capable as the
 * extensions under it: an editor that renders the bar without these gets
 * buttons that silently do nothing. The Terms & Conditions wizard keeps its
 * own useEditor — its hydration and change handling differ — and takes the
 * capability from here instead of re-listing it.
 *
 * PageBreak and PageFlow are included even for editors that never paginate.
 * PageFlow does nothing outside a .ctcte-pageview surface (it checks before
 * measuring), and PageBreak without its toolbar button is simply a node type
 * nobody can insert — while leaving them out would mean any page break already
 * saved in a document could not be parsed back.
 */
export function ctcExtensions(opts?: {
  /** Called when a paste or drop would cross CONTENT_MAX_CHARS. */
  onLimit?: (attempted: number, max: number) => void;
}) {
  return [
    ContentLimit.configure({ max: CONTENT_MAX_CHARS, onExceed: opts?.onLimit }),
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
    LineHeight,
    LegalList,
    FindReplace,
    TextStyle,
    FontSize,
    FontFamily,
    Color,
    BackgroundColor,
    Subscript,
    Superscript,
    /* Tables — Insert Table here, plus tables carried in from an uploaded
       DOCX. resizable: TRUE so a column can be dragged to width the way it
       can in Word; it was off because the widths it writes were considered
       noise in the serialized HTML, but a table you cannot size is a table
       that never fits its content.
       The widths land in a <colgroup>, which the PDF honours (its tables are
       table-layout: fixed) — that path only became safe once the blade
       stopped moving <colgroup> behind the promoted <thead>. */
    StyledTable.configure({ resizable: true }),
    TableFit,
    StyledTableRow,
    StyledTableHeader,
    StyledTableCell,
    ParagraphIndent,
    PageBreak,
    PageFlow,
  ];
}

export function useCtcEditor(opts: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  /** Raised when a paste or drop would cross CONTENT_MAX_CHARS. The editor
   *  blocks the input either way; this is how the screen says so. */
  onLimit?: (attempted: number, max: number) => void;
}): CtcEditor {
  const { value, onChange, editable = true, onLimit } = opts;
  const lastSyncedRef = useRef<string>(value);
  const syncTimer = useRef<number | null>(null);

  const editor = useEditor({
    editable,
    extensions: ctcExtensions({ onLimit }),
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
/* Left/right page margin, in px, as the PDF measures it.
   Clamped to the same 10..60 window as clm-signature-document.blade.php, so a
   margin that can be set here is always a margin the PDF can render. */
export const MARGIN_MIN = 10;
export const MARGIN_MAX = 60;
export type CtcMargins = { left: number; right: number };
export const DEFAULT_MARGINS: CtcMargins = { left: 25, right: 25 };

const SHEET_W = 794;          // A4 at 96dpi
const PX_PER_CM = SHEET_W / 21;

/** Word's ruler: the sheet's full width, with a draggable marker per margin. */
function CtcMarginRuler({ margins, onChange }: { margins: CtcMargins; onChange: (m: CtcMargins) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'left' | 'right' | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const bar = barRef.current;
      if (!bar) return;
      const x = e.clientX - bar.getBoundingClientRect().left;
      // Each side is measured from its OWN edge, which is what the @page rule
      // means by margin-left / margin-right.
      const raw = drag === 'left' ? x : SHEET_W - x;
      const v = Math.round(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, raw)));
      onChange(drag === 'left' ? { ...margins, left: v } : { ...margins, right: v });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, margins, onChange]);

  /* Ticks every half centimetre across the sheet, numbered on the whole ones.
     The ruler used to draw the numbers ALONE, floating with nothing under them,
     so it read as a row of digits rather than a scale — there was no way to see
     where a centimetre actually fell. A21 is 21cm wide, so 42 half-steps. */
  const ticks: { x: number; major: boolean; cm: number }[] = [];
  for (let half = 0; half <= 42; half++) {
    ticks.push({ x: (half / 2) * PX_PER_CM, major: half % 2 === 0, cm: half / 2 });
  }

  return (
    <div className="ctcte-ruler" ref={barRef} style={{ width: SHEET_W }}>
      {/* The greyed ends are the margins — the writable column is what stays white. */}
      <div className="ctcte-ruler-pad" style={{ left: 0, width: margins.left }} />
      <div className="ctcte-ruler-pad" style={{ right: 0, width: margins.right }} />
      {ticks.map(t => (
        <span
          key={`t${t.x}`}
          className={`ctcte-ruler-tick${t.major ? ' is-major' : ''}`}
          style={{ left: t.x }}
        />
      ))}
      {/* 0 and 21 sit on the paper's own edges, where a number has no room and
          nothing to say — the edge is the edge. */}
      {ticks.filter(t => t.major && t.cm > 0 && t.cm < 21).map(t => (
        <span key={`n${t.x}`} className="ctcte-ruler-num" style={{ left: t.x }}>{t.cm}</span>
      ))}
      <button
        type="button" title={`Left margin — ${margins.left}px`}
        className={`ctcte-ruler-grip${drag === 'left' ? ' is-drag' : ''}`}
        style={{ left: margins.left }}
        onPointerDown={e => { e.preventDefault(); setDrag('left'); }} />
      <button
        type="button" title={`Right margin — ${margins.right}px`}
        className={`ctcte-ruler-grip${drag === 'right' ? ' is-drag' : ''}`}
        style={{ left: SHEET_W - margins.right }}
        onPointerDown={e => { e.preventDefault(); setDrag('right'); }} />
    </div>
  );
}

export function CtcEditorContent({ editor, pageView, margins, onMargins, footerText }: {
  editor: Editor | null; pageView?: boolean;
  margins?: CtcMargins; onMargins?: (m: CtcMargins) => void;
  /** Printed at the foot of every sheet, so the draft shows what the PDF will. */
  footerText?: string;
}) {
  if (!editor) return null;
  if (!pageView) return <EditorContent editor={editor} className="ctcte-content" />;
  const m = margins ?? DEFAULT_MARGINS;
  return (
    <div
      className="ctcte-content ctcte-pageview"
      style={{
        ['--pg-ml' as any]: `${m.left}px`,
        ['--pg-mr' as any]: `${m.right}px`,
      }}>
      {onMargins && <CtcMarginRuler margins={m} onChange={onMargins} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Formatting toolbar — render ABOVE the content surface. */
export function CtcToolbar({ editor, dark, hidePageBreak, fonts = FONT_FAMILIES }: {
  editor: Editor | null;
  dark?: boolean;
  /** Fonts the Font control may offer. Defaults to the house face alone — an
   *  agreement is set in one typeface and a clause in another is a defect. Pass
   *  a longer list (TNC_FONT_FAMILIES) where a real choice is wanted. */
  fonts?: { label: string; value: string }[];
  /** Drop the Page Break button. For an editor whose content is a FRAGMENT of
   *  a document rather than a document: a T&C clause is inserted into an
   *  agreement and takes that agreement's pagination, so a break authored here
   *  would land wherever the host happened to drop the clause. */
  hidePageBreak?: boolean;
}) {
  /* ONE menu open at a time.
     These were four independent booleans, so each menu knew only about itself:
     opening Table while Find was up left both on screen, overlapping. A toolbar
     that can show two menus at once is a toolbar where the second one is read
     as part of the first.
     Exclusivity is a property of the state now rather than something every
     handler has to remember — a fifth menu added later inherits it. The
     setters keep the same shape (boolean or updater) so no call site changed. */
  type ToolMenu = 'link' | 'spacing' | 'table' | 'find' | null;
  const [menu, setMenu] = useState<ToolMenu>(null);
  const linkOpen    = menu === 'link';
  const spacingOpen = menu === 'spacing';
  const tableOpen   = menu === 'table';
  const findOpen    = menu === 'find';
  const menuSetter = (name: Exclude<ToolMenu, null>) =>
    (v: boolean | ((prev: boolean) => boolean)) =>
      setMenu(prev => {
        const isOpen = prev === name;
        const next = typeof v === 'function' ? v(isOpen) : v;
        // Closing a menu that is not the open one must not shut the one that is
        // — the popovers' click-away handlers fire on each other.
        return next ? name : (isOpen ? null : prev);
      });
  const setLinkOpen    = menuSetter('link');
  const setSpacingOpen = menuSetter('spacing');
  const setTableOpen   = menuSetter('table');
  const setFindOpen    = menuSetter('find');
  const [findTerm, setFindTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  /* False until the user has actually travelled to a match for the current
     query — see stepMatch. A ref, not state: it must not cause a render. */
  const findVisited = useRef(false);
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
  /* Documents written before the switch to points carry px values, so a stored
     `16px` must not read as blank in a pt dropdown. Converted at 1pt = 1.333px
     and rounded, which lands the old px list exactly on the pt list. */
  const rawFontSize = String(editor.getAttributes('textStyle').fontSize || '');
  const curFontSize = rawFontSize.endsWith('px')
    ? String(Math.round(parseFloat(rawFontSize) * 0.75))
    : rawFontSize.replace('pt', '');
  /* Falls back to the house font rather than to blank. Times New Roman is set
     on the page surface in CSS, not as a mark, so text that was simply typed
     carries no fontFamily attribute and the control read "Font" — as though no
     font were chosen — on a document that is entirely in one. */
  const curFontFamily = String(editor.getAttributes('textStyle').fontFamily || fonts[0].value);
  /* Every structure command is a no-op outside a table, so the menu greys
     them out rather than letting a click do nothing silently. */
  const inTable = editor.isActive('table');

  /* ── Sub points ────────────────────────────────────────────────────────
     The flag belongs on the OUTERMOST ordered list, never on the level the
     caret happens to be in.
     Word applies a multilevel scheme to the whole list, and the CSS here does
     the same: the numbering is `counters(legal, ".")` walking down from the top
     list, so 1 / 1.1 / 1.1.1 only comes out if the top one carries the flag.
     updateAttributes() writes to the nearest matching node — so pressing Tab
     first and then the button marked the SUB-list, leaving the parent on plain
     decimal and the two levels numbering independently. */
  const outerOrderedList = (): { pos: number; node: any } | null => {
    const $from = editor.state.selection.$from;
    let found: { pos: number; node: any } | null = null;
    for (let d = 1; d <= $from.depth; d++) {
      const n = $from.node(d);
      if (n.type.name === 'orderedList' && !found) found = { pos: $from.before(d), node: n };
    }
    return found;   // the SHALLOWEST ordered list, i.e. the top of the list
  };
  const legalListOn = !!outerOrderedList()?.node.attrs.legal;
  const toggleLegalList = () => {
    if (!editor.isActive('orderedList')) {
      // No list yet — make one, then mark it. The new list is the outermost by
      // definition, so a second lookup is not needed.
      editor.chain().focus().toggleOrderedList().updateAttributes('orderedList', { legal: '1' }).run();
      return;
    }
    const outer = outerOrderedList();
    if (!outer) return;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(outer.pos, undefined, {
        ...outer.node.attrs,
        legal: outer.node.attrs.legal ? null : '1',
      }),
    );
    editor.commands.focus();
  };

  /* ── Find and Replace ──────────────────────────────────────────────────
     The plugin owns the matches; these push the query into it and act on what
     it found. Everything goes through the view rather than a chain because a
     search is not a document edit — only the replaces are. */
  /* The matches are computed HERE, from the live document, rather than read
     back out of the plugin.
     TipTap v3's useEditor does not re-render on a transaction unless it is
     asked to (shouldRerenderOnTransaction defaults to false), so a toolbar
     reading plugin state saw whatever was there at the last React render —
     which for a fresh query is an empty match list. That is why the counter
     sat at 0/0 on a word the document plainly contains.
     The plugin still owns the DECORATIONS; it just is not the source of truth
     for the count or for what Enter steps through. Only computed while the
     panel is open with something typed in it, so a closed Find costs nothing
     even on a 200-page agreement. */
  const findMatches: FindMatch[] = (findOpen && findTerm)
    ? collectMatches(editor.state.doc, findTerm, matchCase)
    : [];
  const findCount = findMatches.length;
  const findState: any = findKey.getState(editor.state);
  const findIndex = findCount ? Math.min(findState?.index ?? 0, findCount - 1) + 1 : 0;

  const pushSearch = (term: string, caseSensitive: boolean) => {
    /* Highlights and the counter update as you type; the PAGE does not move.
       Jumping on every keystroke meant the document ran away under a
       half-typed word — "r", "re", "reg" each landing somewhere different —
       and the first real match was reached by accident rather than on purpose.
       Enter (or the arrows) is what travels.
       The matches travel WITH the query so the decorations draw exactly the set
       the counter is counting. */
    const matches = term ? collectMatches(editor.state.doc, term, caseSensitive) : [];
    editor.view.dispatch(
      editor.state.tr.setMeta(findKey, { term, matchCase: caseSensitive, index: 0, matches }),
    );
    findVisited.current = false;
  };

  /* Step to a match and bring it on screen.
     The scroll is done on the DOM, not with the transaction's scrollIntoView().
     That flag is honoured against the FOCUSED selection, and the focus is in
     the Find box — which is where it has to stay, or the next keystroke would
     go into the document instead of the search. So the match is located with
     domAtPos and scrolled directly; that works whether or not the editor holds
     focus. Centred rather than merely "into view", so a match at the very
     bottom of the viewport does not sit under the panel. */
  const stepMatch = (delta: number) => {
    if (!findMatches.length) return;
    const cur = Math.min(findKey.getState(editor.state)?.index ?? 0, findMatches.length - 1);
    /* The first Enter after a new query goes to the match you are already ON,
       not past it. Without this the opening hit was skipped: typing set the
       index to 0 and the first Enter advanced straight to the second. */
    const next = findVisited.current
      ? (cur + delta + findMatches.length) % findMatches.length
      : cur;
    findVisited.current = true;
    const m = findMatches[next];
    editor.view.dispatch(
      editor.state.tr
        .setMeta(findKey, { index: next })
        .setSelection(TextSelection.create(editor.state.doc, m.from, m.to)),
    );
    scrollToMatch(m.from);
  };

  /** Scroll whatever element holds this document position into the middle. */
  const scrollToMatch = (pos: number) => {
    try {
      const at = editor.view.domAtPos(pos);
      const node: any = at?.node;
      const el: HTMLElement | null =
        node?.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
      /* domAtPos throws if the position was mapped away mid-edit — the next
         keystroke recomputes the matches anyway. */
    }
  };

  const replaceCurrent = () => {
    if (!findMatches.length) return;
    const cur = Math.min(findKey.getState(editor.state)?.index ?? 0, findMatches.length - 1);
    const m = findMatches[cur] ?? findMatches[0];
    editor.view.dispatch(editor.state.tr.insertText(replaceTerm, m.from, m.to));
    // The plugin recomputes on docChanged, so the next match is already the
    // current one — nothing to advance by hand.
  };

  const replaceAll = () => {
    if (!findMatches.length) return;
    const tr = editor.state.tr;
    /* Back to front: replacing shifts every position after the match, and
       working backwards leaves the ones still to do untouched. */
    for (let i = findMatches.length - 1; i >= 0; i--) {
      const m = findMatches[i];
      tr.insertText(replaceTerm, m.from, m.to);
    }
    editor.view.dispatch(tr);
  };

  /* Walk up from the caret to the table (or just the row, for a bottom line)
     and rewrite every cell's style in ONE transaction, so the whole change is
     a single undo step. Done through the view rather than a chain because
     updateAttributes only ever reaches the node the caret is actually in —
     here every cell has to be touched. */
  const applyBorders = (spec: BorderSpec, scope: 'table' | 'row') => {
    const { state, view } = editor;
    const $from = state.selection.$from;
    let target: { node: any; pos: number } | null = null;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === (scope === 'row' ? 'tableRow' : 'table')) {
        target = { node: n, pos: $from.before(d) };
        break;
      }
    }
    if (!target) return;

    const tr = state.tr;
    const visitRow = (row: any, rowPos: number) => {
      row.forEach((cell: any, cellOff: number) => {
        const next = withBorders(cell.attrs.style, spec);
        if (next === (cell.attrs.style ?? null)) return;
        tr.setNodeMarkup(rowPos + 1 + cellOff, undefined, { ...cell.attrs, style: next });
      });
    };
    if (scope === 'row') visitRow(target.node, target.pos);
    else target.node.forEach((row: any, rowOff: number) => visitRow(row, target!.pos + 1 + rowOff));

    if (tr.docChanged) view.dispatch(tr);
    editor.commands.focus();
  };
  /* Heading first — getAttributes('paragraph') is empty while the caret sits in
     a heading, and the control would read as unset. */
  const blockAttrs = Object.keys(editor.getAttributes('heading')).length
    ? editor.getAttributes('heading')
    : editor.getAttributes('paragraph');
  const curLineHeight = String(blockAttrs.lineHeight || '');
  const hasSpaceBefore = !!blockAttrs.spaceBefore;
  const hasSpaceAfter  = !!blockAttrs.spaceAfter;

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
      {/* Every cluster is its own flex box, so when the bar runs out of
          width it wraps BETWEEN groups and never mid-group. Wrapping the
          buttons as loose siblings is what made the second row start
          halfway through a set and read as scattered. */}
      {/* Grouped the way a document toolbar is read: what the block IS,
          then how the TEXT looks, then how the PARAGRAPH sits, then lists,
          then things you INSERT, then the tools, then history.
          Find had been sitting among the bold/italic buttons and the sub-point
          numbering next to the highlighters — both were where they first got
          added rather than where they belong. */}
      <div className="ctcte-grp">
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
        className={`ctcte-sel${fonts.length > 1 ? '' : ' ctcte-sel-fixed'}`}
        value={curFontFamily}
        onChange={e => {
          const v = e.target.value;
          if (v) (editor.chain().focus() as any).setFontFamily(v).run();
          else (editor.chain().focus() as any).unsetFontFamily().run();
        }}
        title="Font"
      >
        {/* No blank placeholder — the control always shows the font actually in
            use, and "no font" is not a state a document has. */}
        {fonts.map(f => (
          <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
        ))}
      </select>

      <select
        className="ctcte-sel ctcte-sel-sm"
        value={curFontSize}
        onChange={e => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(`${v}pt`).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
        title="Font size (points)"
      >
        <option value="">Size</option>
        {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <TB active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()}      title="Bold"><b>B</b></TB>
      <TB active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="Italic"><i>I</i></TB>
      <TB active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><u>U</u></TB>
      <TB active={editor.isActive('strike')}    onClick={() => editor.chain().focus().toggleStrike().run()}    title="Strikethrough"><s>S</s></TB>
      {/* Superscript / subscript, text colour and highlight. The extensions for
          all four were already registered in useCtcEditor — only the buttons
          were missing here, which is what would have made switching the Trade
          Document editor onto this toolbar a downgrade. */}
      <TB active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} title="Superscript"><span style={{ fontSize: 11 }}>X²</span></TB>
      <TB active={editor.isActive('subscript')}   onClick={() => editor.chain().focus().toggleSubscript().run()}   title="Subscript"><span style={{ fontSize: 11 }}>X₂</span></TB>
      <label className="ctcte-btn ctcte-color" title="Text colour">
        <span style={{ borderBottom: `3px solid ${editor.getAttributes('textStyle').color || '#1f2937'}`, lineHeight: 1 }}>A</span>
        <input
          type="color"
          value={editor.getAttributes('textStyle').color || '#1f2937'}
          onChange={e => (editor.chain().focus() as any).setColor(e.target.value).run()}
        />
      </label>
      {/* Five everyday highlights inline, so the common case never opens the
          OS colour picker; the last swatch clears it. */}
      {['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#DDD6FE'].map(c => (
        <button
          key={c}
          type="button"
          className="ctcte-swatch"
          style={{ background: c }}
          title="Highlight"
          onMouseDown={e => e.preventDefault()}
          onClick={() => (editor.chain().focus() as any).setBackgroundColor(c).run()}
        />
      ))}
      <button
        type="button"
        className="ctcte-swatch ctcte-swatch-none"
        title="Remove highlight"
        onMouseDown={e => e.preventDefault()}
        onClick={() => (editor.chain().focus() as any).unsetBackgroundColor().run()}
      />

      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <TB active={editor.isActive({ textAlign: 'left' })}    onClick={() => editor.chain().focus().setTextAlign('left').run()}    title="Align left"><Ico d="M3 6h18M3 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'center' })}  onClick={() => editor.chain().focus().setTextAlign('center').run()}  title="Align center"><Ico d="M3 6h18M6 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'right' })}   onClick={() => editor.chain().focus().setTextAlign('right').run()}   title="Align right"><Ico d="M3 6h18M9 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify"><Ico d="M3 6h18M3 12h18M3 18h18" /></TB>


      {/* Line and Paragraph Spacing — Word's menu, same three sections: the
          multiplier list, then the two paragraph-space toggles. A menu rather
          than a <select> because a select cannot hold the toggles, and those
          are the half people actually reach for: line spacing changes the gap
          INSIDE a paragraph, the toggles change the gap BETWEEN paragraphs. */}
      <div className="ctcte-linkwrap">
        <button
          type="button"
          className={`ctcte-pgbtn${spacingOpen ? ' is-open' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setSpacingOpen(o => !o)}
          title={`Line and paragraph spacing${curLineHeight ? ` — ${curLineHeight}` : ''}`}
        >
          {/* Word's icon: the text lines on the right, the up/down arrow that
              measures the gap between them on the left. */}
          <Ico d="M9 5h12M9 12h12M9 19h12M4 4v16M4 4l-2 2.5M4 4l2 2.5M4 20l-2-2.5M4 20l2-2.5" />
          {/* The current value is kept as a caption — it is the one thing the
              icon cannot say, and it is what people check before changing it. */}
          {curLineHeight && <span className="ctcte-btn-val">{curLineHeight}</span>}
        </button>
        {spacingOpen && (
          <>
            {/* Click-away. mousedown-prevented everywhere inside so the caret
                never leaves the document while the menu is open. */}
            <div className="ctcte-spcbd" onMouseDown={e => { e.preventDefault(); setSpacingOpen(false); }} />
            <div className="ctcte-spcpop" onMouseDown={e => e.preventDefault()}>
              {LINE_HEIGHTS.map(h => (
                <button
                  key={h}
                  type="button"
                  className={`ctcte-spcitem${curLineHeight === h ? ' is-on' : ''}`}
                  onClick={() => { (editor.chain().focus() as any).setLineHeight(h).run(); setSpacingOpen(false); }}
                >
                  <span className="ctcte-spctick">{curLineHeight === h ? '✓' : ''}</span>
                  {h === '1' ? '1.0' : h === '2' ? '2.0' : h === '3' ? '3.0' : h}
                </button>
              ))}
              <div className="ctcte-spcsep" />
              <button
                type="button"
                className="ctcte-spcitem"
                onClick={() => {
                  (editor.chain().focus() as any).setSpaceBefore(hasSpaceBefore ? null : PARA_SPACE).run();
                  setSpacingOpen(false);
                }}
              >
                <span className="ctcte-spctick" />
                {hasSpaceBefore ? 'Remove Space Before Paragraph' : 'Add Space Before Paragraph'}
              </button>
              <button
                type="button"
                className="ctcte-spcitem"
                onClick={() => {
                  (editor.chain().focus() as any).setSpaceAfter(hasSpaceAfter ? null : PARA_SPACE).run();
                  setSpacingOpen(false);
                }}
              >
                <span className="ctcte-spctick" />
                {hasSpaceAfter ? 'Remove Space After Paragraph' : 'Add Space After Paragraph'}
              </button>
              <div className="ctcte-spcsep" />
              <button
                type="button"
                className="ctcte-spcitem"
                onClick={() => {
                  (editor.chain().focus() as any).unsetLineHeight().run();
                  (editor.chain().focus() as any).setSpaceBefore(null).run();
                  (editor.chain().focus() as any).setSpaceAfter(null).run();
                  setSpacingOpen(false);
                }}
              >
                <span className="ctcte-spctick" />
                Reset spacing
              </button>
            </div>
          </>
        )}
      </div>
      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <TB active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()}  title="Bullet list"><Ico d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></TB>
      <TB active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><Ico d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2" /></TB>
      <TB onClick={() => changeIndent(1)} title="Increase indent"><Ico d="M3 6h18M3 12h9M3 18h18M17 9l3 3-3 3" /></TB>
      <TB onClick={() => changeIndent(-1)} title="Decrease indent"><Ico d="M3 6h18M3 12h9M3 18h18M21 9l-3 3 3 3" /></TB>


      {/* Sub points. Turns the list under the caret into clause numbering, or
          starts one where there is no list yet. Tab / Shift+Tab then move a
          line in and out a level, the way they already do in any list here. */}
      <TB
        active={legalListOn}
        onClick={toggleLegalList}
        title="Sub points (1.1, 1.1.1)"
      >
        {/* Text, not an icon — deliberately, and the only one on this bar.
            Word's multilevel glyph is stepped rules with markers, which at 13px
            is indistinguishable from the numbered list and the two indent
            buttons standing right next to it: four near-identical icons in a
            row, one of which does something entirely different.
            "1.1" says what the others cannot and is read at a glance. */}
        <span className="ctcte-btn-txt">1.1</span>
      </TB>
      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <div className="ctcte-linkwrap">
        <TB active={editor.isActive('link')} onClick={() => { setLinkUrl(editor.getAttributes('link').href ?? ''); setLinkOpen(o => !o); }} title="Insert link"><Ico d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></TB>
        {linkOpen && (
          <div className="ctcte-linkpop" onMouseDown={e => e.preventDefault()}>
            <input autoFocus className="ctcte-linkinput" placeholder="https://…" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') setLinkOpen(false); }} />
            <button type="button" className="ctcte-linkbtn" onClick={applyLink}>Apply</button>
          </div>
        )}
      </div>


      {/* Table. The extensions were already registered for the Agreement /
          Trade Doc editors and for tables carried in from an uploaded DOCX —
          only the UI was missing here, so this is a menu over commands that
          already worked.
          The structure items are disabled outside a table rather than hidden:
          a menu whose length changes as the caret moves is harder to learn
          than one whose items grey out. */}
      <div className="ctcte-linkwrap">
        <button
          type="button"
          className={`ctcte-pgbtn${tableOpen ? ' is-open' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setTableOpen(o => !o)}
          title="Table"
        >
          <Ico d="M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14" />
        </button>
        {tableOpen && (
          <>
            <div className="ctcte-spcbd" onMouseDown={e => { e.preventDefault(); setTableOpen(false); }} />
            <div className="ctcte-spcpop ctcte-pop-right" onMouseDown={e => e.preventDefault()}>
              {([['3 × 3', 3, 3], ['2 × 2', 2, 2], ['4 × 4', 4, 4]] as [string, number, number][]).map(([label, rows, cols]) => (
                <button
                  key={label}
                  type="button"
                  className="ctcte-spcitem"
                  onClick={() => { editor.chain().focus().insertContent(buildTableHTML(rows, cols)).run(); setTableOpen(false); }}
                >
                  <span className="ctcte-spctick" />Insert Table ({label})
                </button>
              ))}

              <div className="ctcte-spcsep" />
              {([
                ['Insert Row Above',    () => editor.chain().focus().addRowBefore().run()],
                ['Insert Row Below',    () => editor.chain().focus().addRowAfter().run()],
                ['Insert Column Left',  () => editor.chain().focus().addColumnBefore().run()],
                ['Insert Column Right', () => editor.chain().focus().addColumnAfter().run()],
              ] as [string, () => void][]).map(([label, run]) => (
                <button
                  key={label}
                  type="button"
                  className="ctcte-spcitem"
                  disabled={!inTable}
                  onClick={() => { run(); setTableOpen(false); }}
                >
                  <span className="ctcte-spctick" />{label}
                </button>
              ))}

              <div className="ctcte-spcsep" />
              {ROW_HEIGHTS.map(h => (
                <button
                  key={h.label}
                  type="button"
                  className="ctcte-spcitem"
                  disabled={!inTable}
                  onClick={() => {
                    const cur = editor.getAttributes('tableRow')?.style ?? null;
                    editor.chain().focus()
                      .updateAttributes('tableRow', { style: withRowHeight(cur, h.value) })
                      .run();
                    setTableOpen(false);
                  }}
                >
                  <span className="ctcte-spctick" />Row Height — {h.label}
                </button>
              ))}

              <div className="ctcte-spcsep" />
              {([
                ['All Borders',        'all',    'table'],
                ['Row — Bottom Line',  'bottom', 'row'],
                ['No Borders',         'none',   'table'],
              ] as [string, BorderSpec, 'table' | 'row'][]).map(([label, spec, scope]) => (
                <button
                  key={label}
                  type="button"
                  className="ctcte-spcitem"
                  disabled={!inTable}
                  onClick={() => { applyBorders(spec, scope); setTableOpen(false); }}
                >
                  <span className="ctcte-spctick" />{label}
                </button>
              ))}

              <div className="ctcte-spcsep" />
              {([
                ['Merge Cells', () => editor.chain().focus().mergeCells().run()],
                ['Split Cell',  () => editor.chain().focus().splitCell().run()],
                ['Toggle Header Row', () => editor.chain().focus().toggleHeaderRow().run()],
              ] as [string, () => void][]).map(([label, run]) => (
                <button
                  key={label}
                  type="button"
                  className="ctcte-spcitem"
                  disabled={!inTable}
                  onClick={() => { run(); setTableOpen(false); }}
                >
                  <span className="ctcte-spctick" />{label}
                </button>
              ))}

              <div className="ctcte-spcsep" />
              {([
                ['Delete Row',    () => editor.chain().focus().deleteRow().run()],
                ['Delete Column', () => editor.chain().focus().deleteColumn().run()],
                ['Delete Table',  () => editor.chain().focus().deleteTable().run()],
              ] as [string, () => void][]).map(([label, run]) => (
                <button
                  key={label}
                  type="button"
                  className="ctcte-spcitem is-danger"
                  disabled={!inTable}
                  onClick={() => { run(); setTableOpen(false); }}
                >
                  <span className="ctcte-spctick" />{label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      {/* Find and Replace. Its own panel because two inputs, a case toggle, a
          match counter and four actions do not fit a dropdown list. */}
      <div className="ctcte-linkwrap">
        <button
          type="button"
          className={`ctcte-pgbtn${findOpen ? ' is-open' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const next = !findOpen;
            setFindOpen(next);
            // Leaving the panel clears the highlights; they are a search aid,
            // not part of the document.
            if (!next) pushSearch('', matchCase);
            else if (findTerm) pushSearch(findTerm, matchCase);
          }}
          title="Find and replace"
        >
          <Ico d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.35-4.35" />
        </button>
        {findOpen && (
          <div className="ctcte-findpop ctcte-pop-right" onMouseDown={e => e.stopPropagation()}>
            <div className="ctcte-findrow">
              <input
                className="ctcte-linkinput"
                autoFocus
                placeholder="Find"
                value={findTerm}
                onChange={e => { setFindTerm(e.target.value); pushSearch(e.target.value, matchCase); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
                  if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); pushSearch('', matchCase); }
                }}
              />
              <span className="ctcte-findcount">{findTerm ? `${findIndex}/${findCount}` : ''}</span>
              <button type="button" className="ctcte-btn" disabled={!findCount} onClick={() => stepMatch(-1)} title="Previous match">‹</button>
              <button type="button" className="ctcte-btn" disabled={!findCount} onClick={() => stepMatch(1)}  title="Next match">›</button>
            </div>
            <div className="ctcte-findrow">
              <input
                className="ctcte-linkinput"
                placeholder="Replace with"
                value={replaceTerm}
                onChange={e => setReplaceTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); } }}
              />
              <button type="button" className="ctcte-linkbtn" disabled={!findCount} onClick={replaceCurrent}>Replace</button>
              <button type="button" className="ctcte-linkbtn" disabled={!findCount} onClick={replaceAll}>All</button>
            </div>
            <label className="ctcte-findcase">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={e => { setMatchCase(e.target.checked); pushSearch(findTerm, e.target.checked); }}
              />
              Match case
            </label>
          </div>
        )}
      </div>
      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      {/* Page break — the only EXACT control over where the PDF splits. The
          A4 guides on the surface are an estimate (browser and dompdf lay text
          out differently); this is a real instruction dompdf obeys. */}
      {/* Labelled, unlike every other button here. Icon-only was invisible in
          practice: it sat among a dozen formatting glyphs and read as one more
          alignment control, so nobody found it. This is a rare, deliberate
          action with no widely-known glyph — the word is what makes it
          findable. */}
      {!hidePageBreak && (
        <button
          type="button"
          className="ctcte-pgbtn ctcte-pgbtn-label"
          title="Insert a page break — the PDF starts a new page from here"
          onMouseDown={e => e.preventDefault()}
          onClick={() => (editor.chain().focus() as any).setPageBreak().run()}
        >
          <Ico d="M3 5h18M3 19h18M4 12h3M10.5 12h3M17 12h3" />
          Page Break
        </button>
      )}

      {/* Undo / redo share the Page Break group rather than sitting behind a
          divider of their own — two buttons alone were being wrapped onto a
          row by themselves, which read as leftovers rather than a group. */}
      {/* Feather rotate-ccw / rotate-cw. The previous pair drew a nearly closed
          arc with its arrow head lying along the circle, so at 13px both came
          out as plain rings with a stub. */}
      <TB onClick={() => editor.chain().focus().undo().run()} title="Undo"><Ico d="M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></TB>
      <TB onClick={() => editor.chain().focus().redo().run()} title="Redo"><Ico d="M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></TB>
      </div>
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
/* Editor + live preview side by side. Below 1180px the two panes stop being
   usable together — a 32% preview leaves the editor under 700px, which is
   narrower than the A4 sheet it is drawing — so they stack instead, editor
   first. Shared by all three CLM editors (CTC, Trade Document, Agreement)
   because all three lay the split out the same way. */
.clm-editor-split { display: flex; flex: 1; min-height: 0; min-width: 0; }
@media (max-width: 1180px) {
  .clm-editor-split { flex-direction: column; }
  .clm-editor-split > * { width: auto !important; }
  .clm-editor-split > *:last-child { flex: 0 0 42%; min-height: 0; }
}
.ctcte-toolbar { display: flex; align-items: center; gap: 3px; row-gap: 6px; flex-wrap: wrap; padding: 7px 10px; border-bottom: 1px solid #EDE9FE; background: #FAFBFF; flex-shrink: 0; }
.ctcte-toolbar > * { flex-shrink: 0; }
/* A cluster of related controls. nowrap is the load-bearing part: the bar
   wraps, the group inside it does not, so a row break always falls on a
   divider instead of through the middle of the alignment buttons. */
.ctcte-grp { display: flex; align-items: center; gap: 3px; flex-wrap: nowrap; flex-shrink: 0; }
/* An empty group can be left behind when a divider lands at either end. */
.ctcte-grp:empty { display: none; }
/* A divider that ends up first or last on a wrapped row is a line against
   nothing. */
.ctcte-div:first-child, .ctcte-div:last-child { display: none; }
.ctcte-sel { height: 28px; border: 1.5px solid #E5E1F3; border-radius: 8px; background: #fff; color: #4C1D95; font-family: inherit; font-size: 11px; font-weight: 600; padding: 0 8px; cursor: pointer; outline: none; }
.ctcte-sel-sm { min-width: 56px; padding: 0 6px; }
/* The font control has exactly one option, so the native chevron was promising
   a choice that is not there. Dropped rather than the whole control, because
   selecting it still does something: it puts pasted text that carried its own
   font back onto the house face. */
.ctcte-sel-fixed { appearance: none; -webkit-appearance: none; -moz-appearance: none; padding-right: 10px; text-align: left; }
.ctcte-sel-fixed::-ms-expand { display: none; }
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
/* The sheet is 744px because that is A4's printable width, and it is not
   negotiable — every page boundary is measured against it.
   It was briefly scaled up with a CSS transform to fill a full-screen window.
   That has to stay out: a transform over a contenteditable this large makes
   Chrome miss repaint invalidations, so editing after an import left the old
   paint on screen underneath the new one and the document appeared doubled.
   Bounding the workspace is layout only, so it cannot corrupt paint. */
/* Chrome leaves the old paint behind here without this.
   The draft scroller (.ctc-mid-scroll) sits inside a position:fixed, rounded,
   overflow:hidden shell in full screen. Chrome scrolls that by blitting tiles,
   and PageFlow changes the content height underneath it every time a band is
   inserted — so tiles that should have been repainted get reused, and the text
   from before the shift stays on screen under the text from after it. The
   document itself is fine; only the screen is wrong.
   Promoting the page surface to its own layer makes Chrome composite it
   instead of blitting stale tiles. It changes no geometry, so nothing PageFlow
   measures moves.

   The promotion goes HERE and not on .ctc-mid-scroll. will-change: transform
   makes an element the containing block for every position:fixed descendant,
   and .ctc-mid-scroll is also the class on the Panel-02 workspace — an ancestor
   of the draft editor's position:fixed full-screen shell. Promoting it pinned
   full screen inside the panel instead of the viewport. .ctcte-pageview is
   inside that shell and contains nothing fixed, so it is safe. */
.ctcte-pageview { will-change: transform; }

.ctcte-pageview { --pg-w: 744px; background: #EEF0F6; padding: 26px 0 34px; min-height: 100%; box-sizing: border-box; }
/* ── Type metrics, copied from the PDF, not chosen ────────────────────────
   Every number below is read off resources/views/pdf/clm-signature-document
   .blade.php. They were previously eyeballed, and each gap made the editor fit
   MORE on a page than the PDF does, so the breaks drifted earlier and earlier:

     text column   744px here vs 704 there  (.document-content adds 20px of
                   padding each side inside the 25px @page margin) — the widest
                   single error: wider lines wrap less, so paragraphs came out
                   short and pages held too much
     line-height   fixed 15px here vs 1.5 there = 16.5px at an 11px body — 10%
                   more height per line, ~60 lines to a page
     paragraph     .55em (6px) here vs a flat 8px there
     headings      1.55/1.3/1.12em (17/14.3/12.3px) here vs 20/17/15px there  */
.ctcte-content.ctcte-pageview .ProseMirror {
  /* 704 text + 45 left + 45 right = 794 = A4 at 96dpi.
     45 is the 25px @page margin plus .document-content's own 20px. */
  /* 794 (A4) minus both @page margins minus everything the PDF nests inside
     them. There are TWO wrappers, not one:
         .document-section  padding: 0 5px
         .document-content  padding: 18px 20px
     The 5px pair was missed, so the editor's text column was 10px wider than
     the PDF's. Wider lines wrap later, so each page held fractionally more than
     the PDF would — the exact way a boundary drifts early and content the
     editor shows on the next page comes back up on this one.
     Whatever the margins are, the border box is still exactly A4. */
  width: calc(794px - var(--pg-ml, 25px) - var(--pg-mr, 25px) - 50px);
  margin: 0 auto;
  padding: 43px calc(var(--pg-mr, 25px) + 25px) 110px calc(var(--pg-ml, 25px) + 25px);
  box-sizing: content-box;
  /* Load-bearing: PageFlow reads child.offsetTop, which is relative to the
     nearest positioned ancestor. Without this it would measure from somewhere
     up in the page shell and every page boundary would land early. */
  position: relative;
  background: #fff;
  font-size: 11px;
  /* 11 x 1.5 x 1.28 — the template's 1.5 at dompdf's line-box scale. */
  line-height: 21.1px;
  /* Times New Roman — the agreement's house face, and the DEFAULT, so a draft
     is in it whether it was typed here or uploaded as a DOCX (see the
     font-family strip in ClmCtcForm's uploadDocx).
     The stack ends in a generic serif on purpose: dompdf resolves Times New
     Roman to its built-in times metrics, and any machine without the face
     falls back to a serif rather than to the app's sans. */
  font-family: 'Times New Roman', Times, serif;
  /* A sheet is always a whole sheet. Without this an empty draft rendered as a
     short white strip floating in grey, which reads as a broken layout rather
     than as page 1 of 1. */
  min-height: 852px;   /* FIRST_H */
  box-shadow: 0 0 0 1px rgba(16,24,40,.05), 0 2px 5px rgba(16,24,40,.10), 0 12px 28px rgba(16,24,40,.07);
}
/* Every line-height below is the template's value x 1.28, stated in px so the
   browser cannot re-derive it. Measured: a 20px/1.3 heading is 33.2px in
   dompdf, an 11px/1.5 paragraph 21.4px. */
.ctcte-content.ctcte-pageview .ProseMirror p,
.ctcte-content.ctcte-pageview .ProseMirror div { margin: 0 0 8px; line-height: 21.1px; }
/* Headings have to name the font themselves. The page surface sets it on the
   .ProseMirror container and everything inside inherits — except headings,
   because the app's own stylesheet carries a plain element-level rule for
   h1, h2 and h3, and a rule that targets the element beats one inherited from an
   ancestor no matter how specific the ancestor's selector is. So the body came
   out in Times New Roman and every clause title stayed on the app's sans. */
.ctcte-content.ctcte-pageview .ProseMirror h1,
.ctcte-content.ctcte-pageview .ProseMirror h2,
.ctcte-content.ctcte-pageview .ProseMirror h3 {
  margin: 14px 0 8px;
  font-family: 'Times New Roman', Times, serif;
}
/* Same reason, for the rest of what an agreement is written with. */
.ctcte-content.ctcte-pageview .ProseMirror th,
.ctcte-content.ctcte-pageview .ProseMirror td,
.ctcte-content.ctcte-pageview .ProseMirror li,
.ctcte-content.ctcte-pageview .ProseMirror strong,
.ctcte-content.ctcte-pageview .ProseMirror em,
.ctcte-content.ctcte-pageview .ProseMirror blockquote {
  font-family: 'Times New Roman', Times, serif;
}
.ctcte-content.ctcte-pageview .ProseMirror h1 { font-size: 20px; line-height: 33.3px; }
.ctcte-content.ctcte-pageview .ProseMirror h2 { font-size: 17px; line-height: 28.3px; }
.ctcte-content.ctcte-pageview .ProseMirror h3 { font-size: 15px; line-height: 25.0px; }
.ctcte-content.ctcte-pageview .ProseMirror ul,
.ctcte-content.ctcte-pageview .ProseMirror ol { margin: 0 0 8px 24px; padding-left: 0; }
.ctcte-content.ctcte-pageview .ProseMirror li { line-height: 21.1px; }
/* Tables, matched to the PDF the same way the body text is.
   The page view carried NO table CSS — cells fell back to whatever the DOCX
   converter wrote inline, or to browser defaults, so a table-heavy page fitted
   a whole extra table here that the PDF pushed to the next page. dompdf pads
   every cell 6px 8px and lays tables out fixed. */
.ctcte-content.ctcte-pageview .ProseMirror table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ctcte-content.ctcte-pageview .ProseMirror table td,
.ctcte-content.ctcte-pageview .ProseMirror table th {
  padding: 6px 8px; vertical-align: top;
  word-wrap: break-word; overflow-wrap: break-word; word-break: break-word;
}
.ctcte-content.ctcte-pageview .ProseMirror table p { margin: 0; }
/* Column resizing. ProseMirror inserts the handle element but ships no CSS for
   it, so without this the grab area exists and is invisible. */
.ctcte-content .ProseMirror table { position: relative; max-width: 100%; }

/* Sub points (see LegalList). counters(legal, ".") is what turns the nesting
   into 1 / 1.1 / 1.1.1 — counter() alone would print only the innermost level.
   The marker is drawn by ::before, so the native list marker is switched off
   and the item becomes a block; the indent then comes from the nested list's
   own padding rather than from a list marker box. */
.ctcte-content .ProseMirror ol[data-legal],
.ctcte-content .ProseMirror ol[data-legal] ol {
  counter-reset: legal; list-style: none; padding-left: 0; margin-left: 0;
}
.ctcte-content .ProseMirror ol[data-legal] ol { padding-left: 24px; }
.ctcte-content .ProseMirror ol[data-legal] li { display: block; }
.ctcte-content .ProseMirror ol[data-legal] li::before {
  counter-increment: legal;
  content: counters(legal, ".") ". ";
  font-weight: 700;
  margin-right: 6px;
}
/* The number and its text on ONE line.
   A list item's content in ProseMirror is a <p>, and a <p> is a block — so the
   ::before marker took a line of its own and every clause came out as "1." with
   its words underneath. Only the FIRST paragraph goes inline: a clause that
   runs to a second paragraph should still break, it just should not break
   between the number and the sentence it numbers. */
.ctcte-content .ProseMirror ol[data-legal] li > p:first-of-type {
  display: inline;
  margin: 0;
}
/* A nested level is a block again, or the sub-list would run on inside its
   parent's sentence. */
.ctcte-content .ProseMirror ol[data-legal] li > ol { display: block; }
.ctcte-content .ProseMirror .column-resize-handle {
  position: absolute; right: -2px; top: 0; bottom: 0; width: 4px;
  background: #7C3AED; pointer-events: none; z-index: 20;
}
.ctcte-content .ProseMirror.resize-cursor { cursor: col-resize; }
.ctcte-content .ProseMirror th, .ctcte-content .ProseMirror td { position: relative; }
/* The selected-cell wash TipTap toggles while dragging across cells. */
.ctcte-content .ProseMirror .selectedCell::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: rgba(124,58,237,.14);
}
/* A cell with no border of its own still needs an edge while you are editing,
   or a borderless layout table is a set of invisible boxes you cannot click
   into accurately. Dashed and pale so it never reads as a real rule, and it is
   editor-only CSS — nothing here reaches the PDF, which keeps such tables
   clean by design. The :not([style*="border"]) guard steps aside the moment the cell
   carries a real border. */
.ctcte-content.ctcte-pageview .ProseMirror table td:not([style*="border"]),
.ctcte-content.ctcte-pageview .ProseMirror table th:not([style*="border"]) {
  outline: 1px dashed #D8DEE9; outline-offset: -1px;
}

/* ── The PDF's own font ──────────────────────────────────────────────────
   NOTE: the page surface now sets Times New Roman (above) to match the blade.
   The DejaVu faces below are kept because dompdf still falls back to them for
   any glyph Times lacks, and because content that carries its own font-family
   (a pasted table, an uploaded fragment) can still land on them — so the
   editor must be able to measure them.

   dompdf renders the body in DejaVu Sans (see the blade's font-family). The
   editor was rendering in DM Sans, the app font. Same size, same line-height,
   completely different letterforms — so every line wrapped at a different word,
   every paragraph came out a different number of lines, and the two paginations
   could never agree no matter how exactly the box geometry was matched.
   These are dompdf's own .ttf files, published from its lib/fonts, so the
   editor measures the identical typeface the PDF will print. Loaded only where
   they are used, which is the page surface. */
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Oblique.ttf') format('truetype'); font-weight: 400; font-style: italic; font-display: swap; }
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-BoldOblique.ttf') format('truetype'); font-weight: 700; font-style: italic; font-display: swap; }

/* Word's ruler. Sits above the sheet and is exactly as wide as it, so a marker
   is literally over the paper edge it controls. */
.ctcte-ruler {
  position: relative; height: 26px; margin: 0 auto 10px;
  background: #fff; border: 1px solid #E3E6EF; border-radius: 4px;
  box-shadow: 0 1px 2px rgba(16,24,40,.05);
  user-select: none;
}
.ctcte-ruler-pad { position: absolute; top: 0; bottom: 0; background: #E6E9F2; }
/* The scale itself: a short mark every half centimetre, a taller one on the
   whole, numbers above the tall ones. Ticks hang from the BOTTOM edge so the
   scale reads against the paper directly beneath it. */
.ctcte-ruler-tick {
  position: absolute; bottom: 0; width: 1px; height: 4px;
  background: #CBD2E0; transform: translateX(-50%);
}
.ctcte-ruler-tick.is-major { height: 8px; background: #98A2B3; }
.ctcte-ruler-num {
  position: absolute; top: 3px; transform: translateX(-50%);
  font-size: 8px; font-weight: 700; color: #98A2B3; letter-spacing: .02em;
  line-height: 1; pointer-events: none;
}
/* Sits high on the bar so it never covers the ticks it is being dragged
   against. */
.ctcte-ruler-grip {
  position: absolute; top: 7px; width: 11px; height: 11px; padding: 0;
  transform: translate(-50%, -50%) rotate(45deg);
  background: #7C3AED; border: 1px solid #fff; border-radius: 2px;
  cursor: ew-resize; box-shadow: 0 1px 3px rgba(16,24,40,.35);
}
.ctcte-ruler-grip:hover, .ctcte-ruler-grip.is-drag { background: #4C1D95; }
[data-bs-theme="dark"] .ctcte-ruler { background: #1b2028; border-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-ruler-pad { background: #2a3140; }
[data-bs-theme="dark"] .ctcte-ruler-tick { background: #3b4354; }
[data-bs-theme="dark"] .ctcte-ruler-tick.is-major { background: #5b6478; }
[data-bs-theme="dark"] .ctcte-ruler-num { color: #7c8698; }

/* A page boundary that falls inside a single block — a table row taller than a
   sheet, or a very long paragraph. The PDF splits these mid-block and leaves no
   blank tail, so there is nothing to reserve: this is drawn OVER the content,
   absolutely, and costs the layout nothing. */
.ctcte-spanmarks { position: absolute; inset: 0 0 auto 0; height: 0; pointer-events: none; z-index: 2; }

/* One hairline across the paper with the page number on it, for every
   boundary — the reserved blank tail above it is the only thing that differs,
   and that difference is paper, not styling. */
.ctcte-pageline, .ctcte-spanmark {
  position: absolute; height: 0;
  left: calc((var(--pg-ml, 25px) + 25px) * -1);
  right: calc((var(--pg-mr, 25px) + 25px) * -1);
}
.ctcte-pageline { border-top: 1px solid #CFD5E2; box-shadow: 0 4px 8px -6px rgba(16,24,40,.45); }
/* The one boundary that reserves nothing: a block taller than a whole sheet,
   which dompdf breaks in place. It says CONTINUES because the text runs
   straight on underneath it. */
.ctcte-spanmark { border-top: 1px dashed #D3D8E3; }
/* Out past the sheet edge, on the desk.
   Centred above the line it needed clear paper to sit on, and there is none
   when the page ends flush with a block — then it landed on the last line of
   the page it was labelling. The desk beside the sheet is always empty, so it
   cannot collide with anything whatever the tail measures. */
.ctcte-pageline::after, .ctcte-spanmark::after {
  position: absolute; right: 0; top: 0; transform: translate(calc(100% + 8px), -50%);
  padding: 2px 11px; border-radius: 999px;
  background: rgba(255,255,255,.96); border: 1px solid #DDD6FE; color: #7C3AED;
  font-size: 8px; font-weight: 800; letter-spacing: .11em; white-space: nowrap;
}
.ctcte-pageline::after { content: 'PAGE ' attr(data-page) ' ENDS'; }
.ctcte-spanmark::after { content: 'PAGE ' attr(data-page) ' 4 CONTINUES'; }
[data-bs-theme="dark"] .ctcte-pageline { border-top-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-spanmark { border-top-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-pageline::after,
[data-bs-theme="dark"] .ctcte-spanmark::after { background: #1b2028; border-color: #3b2f63; color: #c4b5fd; }

/* The reservations are silent: they hold the space the PDF leaves and nothing
   else. Three things used to draw their own line and their own label, each
   numbering itself, so one boundary could show its label twice. */
.ctcte-pagegap { margin: 0 calc((var(--pg-mr, 25px) + 25px) * -1) 0 calc((var(--pg-ml, 25px) + 25px) * -1); user-select: none; }
.ctcte-pagegap-row > td { padding: 0 !important; border: none !important; user-select: none; }

[data-bs-theme="dark"] .ctcte-content.ctcte-pageview .ProseMirror { background: #1b2028; color: #e5e7eb; }
[data-bs-theme="dark"] .ctcte-pagegap { background: #12151c; border-color: #2a3140; }

/* ── "PAGE N ENDS" boundary markers HIDDEN in the editor ───────────────────
   The Live PDF Preview now shows the real page breaks, so the editor's own
   estimated "PAGE N ENDS" pill + hairline were redundant and noisy while
   writing / after a DOCX upload. The page-tail spacing (--pg-fill gradient) is
   kept so the surface still reads as separated pages — only the label and the
   line are hidden. Nothing is removed from the PageFlow logic; delete this
   block to bring the markers back. */
.ctcte-pgtop::after,
.ctcte-pagegap::after,
.ctcte-pagegap-row > td::after,
/* .ctcte-pageline was missing from this list, which is why "PAGE N ENDS" kept
   showing after it was supposedly removed. Line 505 picks the class per
   boundary: m.sheet ? 'ctcte-pageline' : 'ctcte-spanmark' — pageline is the
   ORDINARY page break and spanmark only appears for a block taller than a
   whole sheet. Only the rare one was being hidden. */
.ctcte-pageline::after,
.ctcte-spanmark::after { content: none !important; display: none !important; }
.ctcte-pgtop::before,
.ctcte-pagegap::before,
.ctcte-pagegap-row > td::before { border-top: none !important; box-shadow: none !important; }
/* The label and the hairline are separate declarations — hiding ::after alone
   would leave the rule floating across the page with no caption. */
.ctcte-pageline,
.ctcte-spanmark { border-top: none !important; box-shadow: none !important; }

.ctcte-pgbtn { height: 26px; padding: 0 9px; border: 1.5px solid #DDD6FE; border-radius: 7px; background: #F5F3FF; color: #6D28D9; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; transition: background .12s, border-color .12s; }
/* Icon-only buttons are square. Without this they keep the 9px side padding a
   labelled button needs and read as wide empty pills. Page Break keeps its
   words — it inserts something permanent, and an icon alone invites the
   accidental click. */
.ctcte-pgbtn:not(.ctcte-pgbtn-label) { padding: 0 6px; }
/* The spacing value beside its icon (1.5, 2.0…). Not a label — the number is
   the state, which no icon can show. */
.ctcte-btn-val { font-size: 9.5px; font-weight: 800; letter-spacing: -.02em; }
/* A button whose glyph IS text (the sub-points 1.1). Sized to sit on the
   same optical weight as the stroked icons around it. */
.ctcte-btn-txt { font-size: 10px; font-weight: 800; letter-spacing: -.02em; }
/* A menu that opens INWARD.
   Every popover here is anchored left:0 under its button, which is right for
   the controls at the start of the bar. Table and Find sit at the far end, so
   from there a left-anchored panel runs past the dialog's right edge and gets
   clipped — the Find box lost its Replace button and both arrows.
   Set by class rather than measured at runtime: these two are always the last
   controls on the bar, so which way they should open is known up front. */
/* Compounded with each popover's own class, not left bare.
   .ctcte-findpop and .ctcte-spcpop both set left:0, and a bare
   .ctcte-pop-right is the same weight (0,1,0) — so the winner came down to
   which rule sits later in the sheet, and both of those do. The class was on
   the element and doing nothing; the panel still opened rightward and off the
   dialog. Compounding makes it (0,2,0) and settles it on specificity. */
.ctcte-findpop.ctcte-pop-right,
.ctcte-spcpop.ctcte-pop-right { left: auto; right: 0; }
.ctcte-pgbtn:hover { background: #EDE9FE; border-color: #C4B5FD; }
[data-bs-theme="dark"] .ctcte-pgbtn { background: rgba(124,58,237,.18); border-color: rgba(124,58,237,.45); color: #C4B5FD; }
.ctcte-div { width: 1px; height: 18px; background: #E5E1F3; margin: 0 3px; }
/* Colour + highlight. The native colour input is laid OVER its swatch so the
   whole button opens the picker instead of sitting beside it as a second
   target. */
.ctcte-color { position: relative; overflow: hidden; font-weight: 800; }
.ctcte-color input[type="color"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; padding: 0; border: none; }
.ctcte-swatch { width: 18px; height: 18px; padding: 0; border: 1.5px solid rgba(15,23,42,.12); border-radius: 5px; cursor: pointer; flex-shrink: 0; }
.ctcte-swatch:hover { border-color: #7C3AED; }
.ctcte-swatch-none { background: #fff; position: relative; }
.ctcte-swatch-none::after { content: ''; position: absolute; inset: 3px; border-top: 1.5px solid #EF4444; transform: rotate(-45deg); }
[data-bs-theme="dark"] .ctcte-swatch { border-color: rgba(255,255,255,.18); }
[data-bs-theme="dark"] .ctcte-swatch-none { background: #1b2230; }
.ctcte-btn { min-width: 26px; height: 26px; padding: 0 6px; border: none; border-radius: 7px; background: none; color: #4C1D95; font-family: 'Georgia', serif; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background .12s, color .12s; }
.ctcte-btn:hover { background: #EDE9FE; }
.ctcte-btn.is-active { background: linear-gradient(135deg,#6D28D9,#7C3AED); color: #fff; }
.ctcte-linkwrap { position: relative; display: inline-flex; }
/* Find & Replace panel + match highlights */
.ctcte-findpop {
  position: absolute; top: 32px; left: 0; z-index: 60;
  width: min(340px, calc(100vw - 24px));
  padding: 9px; background: #fff; border: 1.5px solid #DDD6FE; border-radius: 10px;
  box-shadow: 0 12px 30px rgba(109,40,217,.2);
  display: flex; flex-direction: column; gap: 7px;
}
.ctcte-findrow { display: flex; align-items: center; gap: 6px; }
.ctcte-findrow .ctcte-linkinput { flex: 1; width: auto; min-width: 0; }
.ctcte-findcount { font-size: 10.5px; font-weight: 700; color: #7C3AED; min-width: 38px; text-align: center; white-space: nowrap; }
.ctcte-findcase { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #4C1D95; cursor: pointer; }
.ctcte-findpop .ctcte-linkbtn:disabled,
.ctcte-findpop .ctcte-btn:disabled { opacity: .45; cursor: default; }
/* Every match, and the one you are on. Background only — a match inside bold
   or coloured text must keep looking like that text. */
.ctcte-find-hit { background: #FEF08A; }
.ctcte-find-cur { background: #FB923C; color: #fff; }
[data-bs-theme="dark"] .ctcte-findpop { background: #1b2230; border-color: rgba(124,58,237,.35); }
[data-bs-theme="dark"] .ctcte-findcase { color: #DDD6FE; }
/* Line & paragraph spacing menu */
.ctcte-pgbtn.is-open { background: #EDE9FE; border-color: #C4B5FD; }
.ctcte-spcbd { position: fixed; inset: 0; z-index: 59; }
.ctcte-spcpop {
  position: absolute; top: 32px; left: 0; z-index: 60; min-width: 232px;
  padding: 5px; background: #fff; border: 1.5px solid #DDD6FE; border-radius: 10px;
  box-shadow: 0 12px 30px rgba(109,40,217,.2);
  display: flex; flex-direction: column;
  /* The Table menu is 15 items now and ran off the bottom of the screen, so
     the last of them could not be reached at all. Capped against the VIEWPORT
     rather than a fixed pixel height — the editor is used both in a page panel
     and full screen, and a number that fits one crops the other. */
  max-height: min(58vh, 420px);
  overflow-y: auto;
  /* Scrolling the menu must not scroll the document underneath it once the
     list hits its end. */
  overscroll-behavior: contain;
  /* Near the right edge of a narrow window a left-anchored menu would push the
     page sideways; it stays inside the viewport instead. */
  max-width: min(320px, calc(100vw - 24px));
  scrollbar-width: thin; scrollbar-color: #DDD6FE transparent;
}
.ctcte-spcpop::-webkit-scrollbar { width: 8px; }
.ctcte-spcpop::-webkit-scrollbar-thumb { background: #DDD6FE; border-radius: 99px; }
.ctcte-spcitem {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 9px; border: none; border-radius: 7px; background: none;
  font-family: inherit; font-size: 11.5px; font-weight: 600; color: #4C1D95;
  text-align: left; white-space: nowrap; cursor: pointer; transition: background .12s;
}
.ctcte-spcitem:hover { background: #F5F3FF; }
.ctcte-spcitem:disabled { color: #A9A3C4; cursor: default; }
.ctcte-spcitem:disabled:hover { background: none; }
.ctcte-spcitem.is-danger { color: #B91C1C; }
.ctcte-spcitem.is-danger:hover { background: #FEF2F2; }
.ctcte-spcitem.is-danger:disabled { color: #D9B3B3; }
.ctcte-spcitem.is-danger:disabled:hover { background: none; }
.ctcte-spcitem.is-on { background: #EDE9FE; color: #6D28D9; font-weight: 800; }
.ctcte-spctick { width: 12px; flex-shrink: 0; font-size: 11px; color: #7C3AED; }
.ctcte-spcsep { height: 1px; margin: 4px 6px; background: #EDE9FE; }
[data-bs-theme="dark"] .ctcte-spcpop { background: #1b2230; border-color: rgba(124,58,237,.35); }
[data-bs-theme="dark"] .ctcte-spcitem { color: #DDD6FE; }
[data-bs-theme="dark"] .ctcte-spcitem:hover { background: rgba(124,58,237,.18); }
[data-bs-theme="dark"] .ctcte-spcitem.is-on { background: rgba(124,58,237,.28); color: #fff; }
[data-bs-theme="dark"] .ctcte-spcsep { background: rgba(124,58,237,.25); }
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
