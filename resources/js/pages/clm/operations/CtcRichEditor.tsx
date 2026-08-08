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
const PAGE_GAP = 0;
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
              | { kind: 'pad'; from: number; to: number; fill: number }
              | { kind: 'band'; at: number; key: string; h: number; row: boolean; cols: number }
              | { kind: 'mark'; top: number };
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
                if (fill > 0) bounds.push({ kind: 'band', at: u.pos + u.size, key: `pb${u.pos}`, h: fill + PAGE_GAP, row: false, cols: 0 });
                else bounds.push({ kind: 'mark', top: u.phys + u.height });
                cap = (fill > 0 ? bottom : cap) + PAGE_H;
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
                const fill = Math.round(cap - u.top);
                if (fill > 0) bounds.push(u.row
                  ? { kind: 'band', at: u.pos, key: `pg${u.pos}`, h: fill + PAGE_GAP, row: true, cols: u.cols }
                  : { kind: 'pad', from: u.pos, to: u.pos + u.size, fill });
                // Sheet ended exactly at this block's edge — nothing to reserve,
                // but still a boundary, so still a mark.
                else bounds.push({ kind: 'mark', top: u.phys });
                cap = (fill > 0 ? u.top : cap) + PAGE_H;
              }

              /* Taller than a whole sheet, so it cannot be pushed anywhere —
                 dompdf has to break it in place, and so do we. */
              while (u.top + u.height > cap) {
                bounds.push({ kind: 'mark', top: u.phys + (cap - u.top) });
                cap += PAGE_H;
              }
            }

            const decos: Decoration[] = [];
            const sigParts: string[] = [];
            const marks = bounds
              .map((b, i) => ({ b, page: i + 1 }))
              .filter(x => x.b.kind === 'mark') as { b: { kind: 'mark'; top: number }; page: number }[];

            bounds.forEach((b, i) => {
              const from = i + 1;
              if (b.kind === 'pad') {
                sigParts.push(`p${b.from}:${b.fill}:${from}`);
                decos.push(Decoration.node(b.from, b.to, {
                  class: 'ctcte-pgtop',
                  style: `--pg-fill:${b.fill}px`,
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
              sigParts.push('m' + marks.map(m => `${Math.round(m.b.top)}/${m.page}`).join('.'));
              decos.push(Decoration.widget(0, () => {
                const wrap = document.createElement('div');
                wrap.className = 'ctcte-spanmarks';
                wrap.contentEditable = 'false';
                for (const m of marks) {
                  const line = document.createElement('div');
                  line.className = 'ctcte-spanmark';
                  line.style.top = `${Math.round(m.b.top)}px`;
                  line.setAttribute('data-page', String(m.page));
                  wrap.appendChild(line);
                }
                return wrap;
              }, { side: -1, key: 'spans' }));
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

  const ticks = [];
  for (let cm = 1; cm < 21; cm++) ticks.push(cm);

  return (
    <div className="ctcte-ruler" ref={barRef} style={{ width: SHEET_W }}>
      {/* The greyed ends are the margins — the writable column is what stays white. */}
      <div className="ctcte-ruler-pad" style={{ left: 0, width: margins.left }} />
      <div className="ctcte-ruler-pad" style={{ right: 0, width: margins.right }} />
      {ticks.map(cm => (
        <span key={cm} className="ctcte-ruler-tick" style={{ left: cm * PX_PER_CM }}>{cm}</span>
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

export function CtcEditorContent({ editor, pageView, margins, onMargins }: {
  editor: Editor | null; pageView?: boolean;
  margins?: CtcMargins; onMargins?: (m: CtcMargins) => void;
}) {
  if (!editor) return null;
  if (!pageView) return <EditorContent editor={editor} className="ctcte-content" />;
  const m = margins ?? DEFAULT_MARGINS;
  return (
    <div
      className="ctcte-content ctcte-pageview"
      style={{ ['--pg-ml' as any]: `${m.left}px`, ['--pg-mr' as any]: `${m.right}px` }}>
      {onMargins && <CtcMarginRuler margins={m} onChange={onMargins} />}
      <EditorContent editor={editor} />
    </div>
  );
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

      {/* Page Break button hidden from the toolbar per request — kept in code
          (NOT removed), so flip this guard to true to bring it back. The
          pageBreak node/command and PDF handling are untouched; only the
          toolbar entry is hidden. */}
      {false && (<>
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
      </>)}

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
  font-family: 'DejaVu Sans', Arial, Helvetica, sans-serif;
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
.ctcte-content.ctcte-pageview .ProseMirror h1,
.ctcte-content.ctcte-pageview .ProseMirror h2,
.ctcte-content.ctcte-pageview .ProseMirror h3 { margin: 14px 0 8px; }
.ctcte-content.ctcte-pageview .ProseMirror h1 { font-size: 20px; line-height: 33.3px; }
.ctcte-content.ctcte-pageview .ProseMirror h2 { font-size: 17px; line-height: 28.3px; }
.ctcte-content.ctcte-pageview .ProseMirror h3 { font-size: 15px; line-height: 25.0px; }
.ctcte-content.ctcte-pageview .ProseMirror ul,
.ctcte-content.ctcte-pageview .ProseMirror ol { margin: 0 0 8px; padding-left: 24px; }
.ctcte-content.ctcte-pageview .ProseMirror li { line-height: 21.1px; }

/* ── The PDF's own font ──────────────────────────────────────────────────
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
  position: relative; height: 22px; margin: 0 auto 10px;
  background: #fff; border: 1px solid #E3E6EF; border-radius: 4px;
  box-shadow: 0 1px 2px rgba(16,24,40,.05);
  user-select: none;
}
.ctcte-ruler-pad { position: absolute; top: 0; bottom: 0; background: #E6E9F2; }
.ctcte-ruler-tick {
  position: absolute; top: 4px; transform: translateX(-50%);
  font-size: 7.5px; font-weight: 700; color: #98A2B3; letter-spacing: .04em;
}
.ctcte-ruler-grip {
  position: absolute; top: 50%; width: 11px; height: 11px; padding: 0;
  transform: translate(-50%, -50%) rotate(45deg);
  background: #7C3AED; border: 1px solid #fff; border-radius: 2px;
  cursor: ew-resize; box-shadow: 0 1px 3px rgba(16,24,40,.35);
}
.ctcte-ruler-grip:hover, .ctcte-ruler-grip.is-drag { background: #4C1D95; }
[data-bs-theme="dark"] .ctcte-ruler { background: #1b2028; border-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-ruler-pad { background: #2a3140; }

/* A page boundary that falls inside a single block — a table row taller than a
   sheet, or a very long paragraph. The PDF splits these mid-block and leaves no
   blank tail, so there is nothing to reserve: this is drawn OVER the content,
   absolutely, and costs the layout nothing. */
.ctcte-spanmarks { position: absolute; inset: 0 0 auto 0; height: 0; pointer-events: none; z-index: 2; }
.ctcte-spanmark {
  position: absolute; left: -45px; right: -45px; height: 0;
  border-top: 1px solid #CFD5E2;
  box-shadow: 0 4px 8px -6px rgba(16,24,40,.45);
}
[data-bs-theme="dark"] .ctcte-spanmark::after { background: #1b2028; border-color: #3b2f63; color: #c4b5fd; }

/* A block carrying the blank tail of the sheet above it. Padding, not a spacer
   element: the space is real (dompdf leaves it) but it needs no DOM of its own,
   and DOM that appears and disappears is what makes the paint smear. */
.ctcte-pgtop { padding-top: var(--pg-fill, 0px) !important; position: relative; }
.ctcte-pgtop::before {
  content: ''; position: absolute; top: var(--pg-fill, 0px);
  left: calc((var(--pg-ml, 25px) + 25px) * -1);
  right: calc((var(--pg-mr, 25px) + 25px) * -1);
  border-top: 1px solid #CFD5E2;
}
.ctcte-pgtop::after {
  content: 'PAGE ' attr(data-from) ' ENDS';
  position: absolute; left: 50%; top: var(--pg-fill, 0px); transform: translate(-50%, -50%);
  padding: 2px 11px; border-radius: 999px;
  background: rgba(255,255,255,.96); border: 1px solid #DDD6FE; color: #7C3AED;
  font-size: 8px; font-weight: 800; letter-spacing: .11em; white-space: nowrap;
}
[data-bs-theme="dark"] .ctcte-pgtop::before { border-top-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-pgtop::after { background: #1b2028; border-color: #3b2f63; color: #c4b5fd; }

/* ── One design for every page boundary ───────────────────────────────────
   A boundary is always the same thing on screen: a hairline across the paper
   with the page number on it. What differs is only what sits ABOVE that line,
   and that difference is real, not stylistic:

     block moved down   the tail of the sheet it left is genuinely blank paper
                        in the PDF, so it is drawn as blank paper — white —
                        and the line goes at its bottom, on the actual paper
                        edge. --pg-fill is exactly how much blank tail there is.
     split in place     the PDF splits mid-block and leaves no tail, so there
                        is nothing above the line at all.

   Two visual languages for the same event was the confusing part; the earlier
   band also centred its label in the strip rather than on the paper edge, so
   it did not even mark the right spot. */
.ctcte-pagegap {
  position: relative;
  margin: 0 calc((var(--pg-mr, 25px) + 25px) * -1) 0 calc((var(--pg-ml, 25px) + 25px) * -1);
  background: linear-gradient(#fff 0 var(--pg-fill, 0px), #EEF0F6 var(--pg-fill, 0px) 100%);
  user-select: none;
}
.ctcte-pagegap-row > td {
  padding: 0 !important;
  border: none !important;
  position: relative;
  background: linear-gradient(#fff 0 var(--pg-fill, 0px), #EEF0F6 var(--pg-fill, 0px) 100%) !important;
  user-select: none;
}
/* The line itself, and the label sitting on it. Shared by all three boundary
   kinds so they cannot drift apart again. */
.ctcte-pagegap::before,
.ctcte-pagegap-row > td::before {
  content: ''; position: absolute; left: 0; right: 0; top: var(--pg-fill, 0px);
  border-top: 1px solid #CFD5E2;
  box-shadow: 0 4px 8px -6px rgba(16,24,40,.45);
}
.ctcte-pagegap::after,
.ctcte-pagegap-row > td::after,
.ctcte-spanmark::after {
  content: 'PAGE ' attr(data-from) ' ENDS';
  position: absolute; left: 50%; top: var(--pg-fill, 0px); transform: translate(-50%, -50%);
  padding: 2px 11px; border-radius: 999px;
  background: rgba(255,255,255,.96); border: 1px solid #DDD6FE; color: #7C3AED;
  font-size: 8px; font-weight: 800; letter-spacing: .11em; white-space: nowrap;
  box-shadow: 0 1px 2px rgba(16,24,40,.06);
}
.ctcte-spanmark::after { content: 'PAGE ' attr(data-page) ' ENDS'; }
[data-bs-theme="dark"] .ctcte-pagegap { background: linear-gradient(#1b2028 0 var(--pg-fill, 0px), #12151c var(--pg-fill, 0px) 100%); }
[data-bs-theme="dark"] .ctcte-pagegap-row > td { background: linear-gradient(#1b2028 0 var(--pg-fill, 0px), #12151c var(--pg-fill, 0px) 100%) !important; }
[data-bs-theme="dark"] .ctcte-pagegap::before,
[data-bs-theme="dark"] .ctcte-pagegap-row > td::before { border-top-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-pagegap::after,
[data-bs-theme="dark"] .ctcte-pagegap-row > td::after,
[data-bs-theme="dark"] .ctcte-spanmark::after { background: #1b2028; border-color: #3b2f63; color: #c4b5fd; }
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
.ctcte-spanmark::after { content: none !important; display: none !important; }
.ctcte-pgtop::before,
.ctcte-pagegap::before,
.ctcte-pagegap-row > td::before { border-top: none !important; box-shadow: none !important; }
.ctcte-spanmark { border-top: none !important; box-shadow: none !important; }

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
