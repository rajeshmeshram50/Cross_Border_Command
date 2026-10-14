import { createPortal } from 'react-dom';
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

const INDENT_STEP = 28;
const INDENT_MAX = 10;

const PAGE_H   = 964;
const HEAD_H   = 94;
const DOC_PAD  = 18;
const FIRST_H  = PAGE_H - HEAD_H - DOC_PAD;
const PAGE_GAP = 0;
const MANUAL_TAIL_MAX = 90;
const PAGINATE_MAX_BLOCKS = 12000;

export const CTC_PAGINATED_EVENT = 'ctc-paginated';
export const CTC_PAGINATING_EVENT = 'ctc-paginating';

export function waitForPagination(
  editor: Editor | null,
  onProgress?: (pages: number) => void,
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
          let signature: string | null = null;
          let retries = 0;
          const MEASURE_RETRIES = 240;

          const measure = () => {
            const dom = view.dom as HTMLElement;
            const settled = () => dom.dispatchEvent(new CustomEvent(CTC_PAGINATED_EVENT));
            if (!dom.isConnected || !dom.closest('.ctcte-pageview')) return;
            if (view.state.doc.childCount > PAGINATE_MAX_BLOCKS) { settled(); return; }

            const kids = Array.from(dom.children) as HTMLElement[];

            const isOurs = (el: HTMLElement) =>
              el.classList.contains('ctcte-pagegap') || el.classList.contains('ctcte-spanmarks');

            let blocks = 0;
            for (const child of kids) if (!isOurs(child)) blocks += 1;
            if (blocks !== view.state.doc.childCount) {
              if (retries < MEASURE_RETRIES) { retries += 1; schedule(true); return; }
              settled();
              return;
            }
            retries = 0;

            const padTop = parseFloat(getComputedStyle(dom).paddingTop) || 0;

            const rowsOf = (el: HTMLElement): HTMLElement[] | null => {
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

            type Unit = { top: number; height: number; phys: number; pos: number; size: number; row: boolean; cols: number; brk: boolean };
            const units: Unit[] = [];
            let gapAcc = 0;
            let di = 0;
            for (const child of kids) {
              if (child.classList.contains('ctcte-spanmarks')) continue;
              if (child.classList.contains('ctcte-pagegap')) { gapAcc += child.offsetHeight; continue; }
              const own = child.classList.contains('ctcte-pgtop')
                ? (parseFloat(getComputedStyle(child).paddingTop) || 0) : 0;
              const dk = docKids[di++];
              if (!dk) break;

              const rows = dk.node.type.name === 'table' ? rowsOf(child) : null;
              const content = rows?.filter(r => !r.classList.contains('ctcte-pagegap-row'));
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

            const last = units[units.length - 1];
            if (units.length && last.top + last.height <= 0) {
              if (retries < MEASURE_RETRIES) { retries += 1; schedule(true); }
              return;
            }

            type Bound =
              | { kind: 'pad'; from: number; to: number; fill: number; line: number }
              | { kind: 'band'; at: number; key: string; h: number; row: boolean; cols: number; line: number; silent?: boolean }
              | { kind: 'mark'; line: number };
            const bounds: Bound[] = [];
            let cap = FIRST_H;

            for (const u of units) {
              if (u.brk) {
                const bottom = u.top + u.height;
                const fill = Math.round(cap - bottom);
                const room = Math.max(0, fill);
                const shown = Math.min(room, MANUAL_TAIL_MAX);
                bounds.push({ kind: 'band', at: u.pos + u.size, key: `pb${u.pos}`,
                              h: shown + PAGE_GAP, row: false, cols: 0, silent: true,
                              line: u.phys + u.height + shown });
                cap = bottom + room + PAGE_H;
                continue;
              }

              if (u.height <= PAGE_H && u.top + u.height > cap) {
                const fill = Math.round(cap - u.top);
                const room = Math.max(0, fill);
                const line = u.phys + room;
                bounds.push(u.row
                  ? { kind: 'band', at: u.pos, key: `pg${u.pos}`, h: room + PAGE_GAP, row: true, cols: u.cols, line }
                  : { kind: 'pad', from: u.pos, to: u.pos + u.size, fill: room, line });
                cap = u.top + PAGE_H;
              }

              while (u.top + u.height > cap) {
                bounds.push({ kind: 'mark', line: u.phys + (cap - u.top) });
                cap += PAGE_H;
              }
            }

            const decos: Decoration[] = [];
            const sigParts: string[] = [];
            const marks = bounds
              .map((b, i) => ({
                top: b.line, page: i + 1,
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
              }, { side: -1, key: 'spans:' + marksSig }));
            }

            const sig = sigParts.join(',');
            if (sig === signature) { settled(); return; }
            signature = sig;
            dom.dispatchEvent(new CustomEvent(CTC_PAGINATING_EVENT, { detail: { pages: bounds.length + 1 } }));
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
            schedule(true);
          };

          const schedule = (immediate = false) => {
            const delay = immediate ? 0 : (view.state.doc.childCount > 1200 ? 600 : 160);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(measure);
            }, delay);
          };

          schedule();
          (document as any).fonts?.ready?.then(() => schedule(true));
          return {
            update: () => schedule(),
            destroy() { window.clearTimeout(timer); cancelAnimationFrame(frame); },
          };
        },
      }),
    ];
  },
});

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div.page-break' }, { tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    return ['div', { class: 'page-break', 'data-page-break': 'true' }];
  },
  addCommands() {
    return {
      setPageBreak: () => ({ chain }: any) =>
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

const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
];

export const TNC_FONT_FAMILIES: { label: string; value: string }[] = [
  { label: 'Arial',           value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri',         value: "Calibri, 'Segoe UI', sans-serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Georgia',         value: 'Georgia, serif' },
  { label: 'Cambria',         value: 'Cambria, Georgia, serif' },
];

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36'];

const TBL_BORDER = '1px solid #94A3B8';
function buildTableHTML(rows: number, cols: number): string {
  const th = `<th style="border:${TBL_BORDER};padding:6px 8px;background:#EEF2F7;vertical-align:top;text-align:left"><p></p></th>`;
  const td = `<td style="border:${TBL_BORDER};padding:6px 8px;vertical-align:top"><p></p></td>`;
  const head = `<tr>${th.repeat(cols)}</tr>`;
  const body = `<tr>${td.repeat(cols)}</tr>`.repeat(Math.max(0, rows - 1));
  return `<table style="width:100%;table-layout:fixed;border-collapse:collapse"><tbody>${head}${body}</tbody></table><p></p>`;
}

const ROW_HEIGHTS: { label: string; value: string | null }[] = [
  { label: 'Auto (fit text)', value: null },
  { label: 'Short',  value: '28px' },
  { label: 'Medium', value: '40px' },
  { label: 'Tall',   value: '56px' },
];

function withRowHeight(style: string | null | undefined, height: string | null): string | null {
  const kept = String(style || '')
    .split(';')
    .map(d => d.trim())
    .filter(d => d && !/^min-height\s*:/i.test(d) && !/^height\s*:/i.test(d));
  if (height) kept.push(`min-height: ${height}`);
  return kept.length ? kept.join('; ') : null;
}

type BorderSpec = 'all' | 'bottom' | 'none';

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

const keepStyleAttr = {
  style: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('style'),
    renderHTML: (attrs: { style?: string | null }) => (attrs.style ? { style: attrs.style } : {}),
  },
};
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

            const cols: number[] = [];
            firstRow.forEach(cell => {
              const span = cell.attrs.colspan || 1;
              const cw = cell.attrs.colwidth;
              for (let i = 0; i < span; i++) cols.push(Array.isArray(cw) ? (cw[i] || 0) : 0);
            });
            if (!cols.length) return false;

            const knownTotal = cols.reduce((a, b) => a + b, 0);
            const missing = cols.filter(w => !w).length;

            const spare = Math.max(0, PAGE_CONTENT_W - knownTotal);
            const share = missing ? Math.max(MIN_COL_W, Math.floor(spare / missing)) : 0;
            const filled = cols.map(w => (w ? w : share));

            const total = filled.reduce((a, b) => a + b, 0);
            const factor = total > 0 ? PAGE_CONTENT_W / total : 1;
            const final = filled.map(w => Math.max(MIN_COL_W, Math.round(w * factor)));

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

            return false;
          });

          return changed ? tr : null;
        },
      }),
    ];
  },
});

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

const findKey = new PluginKey('findReplace');

type FindMatch = { from: number; to: number };
type FindState = { term: string; matchCase: boolean; matches: FindMatch[]; index: number };

const isWordChar = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c);

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
      const okStart = !isWordChar(hay[at - 1]);
      const okEnd   = !isWordChar(hay[at + needle.length]);
      if (okStart && okEnd) out.push({ from: map[at], to: map[at + needle.length - 1] + 1 });
      at = hay.indexOf(needle, at + needle.length);
    }
    return false;
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
  insertHTML: (html: string) => void;
  insertText: (text: string) => void;
  setHTML: (html: string) => void;
}

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

export const CONTENT_MAX_CHARS = 1000000;

type ContentLimitOptions = {
  max: number;
  onExceed?: (attempted: number, max: number) => void;
};

export const contentTextLength = (editor: Editor | null | undefined): number =>
  editor ? (editor.getText({ blockSeparator: '\n' }) ?? '').length : 0;

export const pastedLength = (raw: string): number => htmlTextLength(raw);

export const preCheckMax = (max: number): number => Math.round(max * 1.02);

export const htmlTextLength = (html: string): number => {
  if (!html) return 0;
  if (!/<[a-z!/]/i.test(html)) return html.trim().length;
  const spaced = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n');
  try {
    return (new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '').trim().length;
  } catch {
    return spaced.replace(/<[^>]*>/g, '').trim().length;
  }
};

const LinkTitle = Extension.create({
  name: 'linkTitle',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mouseover: (_view, event) => {
              const el = event.target as HTMLElement | null;
              const a = el?.closest?.('a[href]') as HTMLAnchorElement | null;
              if (a) {
                const href = a.getAttribute('href') || '';
                if (a.getAttribute('title') !== href) a.setAttribute('title', href);
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});

export const selShadowKey = new PluginKey('ctcSelShadow');
const SelectionShadow = Extension.create({
  name: 'ctcSelShadow',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: selShadowKey,
        state: {
          init: () => null as { from: number; to: number } | null,
          apply(tr, prev) {
            const meta = tr.getMeta(selShadowKey);
            if (meta !== undefined) return meta;
            if (!prev) return null;
            return { from: tr.mapping.map(prev.from), to: tr.mapping.map(prev.to) };
          },
        },
        props: {
          decorations(state) {
            const r = selShadowKey.getState(state);
            if (!r || r.from >= r.to) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.inline(r.from, r.to, { class: 'ctcte-selshadow' }),
            ]);
          },
        },
      }),
    ];
  },
});

export const limitTextLen = (editor: Editor | null | undefined): number => {
  if (!editor) return 0;
  const len = contentTextLength(editor);
  const store = (editor.storage as unknown as Record<string, { textLen?: number } | undefined>).contentLimit;
  if (store) store.textLen = len;
  return len;
};

const ContentLimit = Extension.create<ContentLimitOptions>({
  name: 'contentLimit',
  addOptions() {
    return { max: CONTENT_MAX_CHARS, onExceed: undefined };
  },
  addStorage() {
    return { textLen: 0, lastWarn: 0 };
  },
  onCreate() { this.storage.textLen = contentTextLength(this.editor); },
  onUpdate() { this.storage.textLen = contentTextLength(this.editor); },
  addProseMirrorPlugins() {
    const { max, onExceed } = this.options;
    const editor = this.editor;
    const storage = this.storage;

    const warn = (attempted: number) => {
      const now = Date.now();
      if (now - storage.lastWarn < 2000) return;
      storage.lastWarn = now;
      onExceed?.(attempted, max);
    };

    const wouldOverflow = (incoming: number): boolean => {
      const attempted = contentTextLength(editor) + incoming;
      if (attempted <= max) return false;
      warn(attempted);
      return true;
    };

    const atCeiling = (incoming: number): boolean => {
      if (storage.textLen + incoming <= max) return false;
      storage.textLen = contentTextLength(editor);
      const attempted = storage.textLen + incoming;
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
          handleTextInput(_view, _from, _to, text) {
            return atCeiling(text.length);
          },
          handleKeyDown(_view, event) {
            if (event.key !== 'Enter') return false;
            return atCeiling(8);
          },
        },
      }),
    ];
  },
});

const LIST_TYPES = new Set(['bulletList', 'orderedList']);

const PasteOutOfList = Extension.create({
  name: 'pasteOutOfList',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pasteOutOfList'),
        props: {
          handlePaste(view, _event, slice) {
            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty || !$from.parent.isTextblock) return false;
            const first = slice.content.firstChild;
            if (!first || first.isInline) return false;
            if (slice.content.childCount < 2 && first.isTextblock) return false;
            if ($from.parentOffset !== $from.parent.content.size) return false;

            let listDepth = -1;
            for (let d = $from.depth - 1; d > 0; d--) {
              const node = $from.node(d);
              if (node.type.name !== 'listItem' && !LIST_TYPES.has(node.type.name)) break;
              if ($from.index(d) !== node.childCount - 1) break;
              if (LIST_TYPES.has(node.type.name)) listDepth = d;
            }
            if (listDepth < 0) return false;

            try {
              const tr = state.tr;
              let insertAt = $from.after(listDepth);
              const li = $from.node($from.depth - 1);
              if ($from.parent.content.size === 0 && li.type.name === 'listItem' && li.childCount === 1) {
                let d = $from.depth - 1;
                while (d > listDepth && $from.node(d - 1).childCount === 1) d--;
                const from = $from.before(d), to = $from.after(d);
                tr.delete(from, to);
                insertAt = tr.mapping.map(insertAt, -1);
              }
              tr.replaceRange(insertAt, insertAt, slice);
              const end = tr.mapping.map(insertAt, 1);
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
              view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
              return true;
            } catch {
              return false;
            }
          },
        },
      }),
    ];
  },
});

export function ctcExtensions(opts?: {
  onLimit?: (attempted: number, max: number) => void;
}) {
  return [
    ContentLimit.configure({ max: CONTENT_MAX_CHARS, onExceed: opts?.onLimit }),
    PasteOutOfList,
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
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
    Subscript.extend({ excludes: 'subscript superscript' }),
    Superscript.extend({ excludes: 'superscript subscript' }),
    StyledTable.configure({ resizable: true }),
    TableFit,
    StyledTableRow,
    StyledTableHeader,
    StyledTableCell,
    ParagraphIndent,
    PageBreak,
    PageFlow,
    LinkTitle,
    SelectionShadow,
  ];
}

export function useCtcEditor(opts: {
  value: string;
  onChange: (html: string, textLen: number) => void;
  editable?: boolean;
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
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => onChange(html, limitTextLen(editor)), 250);
    },
  });

  useEffect(() => () => { if (syncTimer.current) window.clearTimeout(syncTimer.current); }, []);
  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

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
      editor.commands.setContent(repaired || '<p></p>', { emitUpdate: false });
      const seeded = editor.getHTML() || repaired || '<p></p>';
      lastSyncedRef.current = seeded;
      const len = contentTextLength(editor);
      const limit = (editor.storage as unknown as Record<string, { textLen?: number }>).contentLimit;
      if (limit) limit.textLen = len;
      onChange(seeded, len);
    },
  };
}

export const MARGIN_MIN = 10;
export const MARGIN_MAX = 60;
export type CtcMargins = { left: number; right: number };
export const DEFAULT_MARGINS: CtcMargins = { left: 25, right: 25 };

export const SHEET_W = 794;
const PX_PER_CM = SHEET_W / 21;

function CtcMarginRuler({ margins, onChange }: { margins: CtcMargins; onChange: (m: CtcMargins) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<'left' | 'right' | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const bar = barRef.current;
      if (!bar) return;
      const x = e.clientX - bar.getBoundingClientRect().left;
      const raw = drag === 'left' ? x : SHEET_W - x;
      const v = Math.round(Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, raw)));
      onChange(drag === 'left' ? { ...margins, left: v } : { ...margins, right: v });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, margins, onChange]);

  const ticks: { x: number; major: boolean; cm: number }[] = [];
  for (let half = 0; half <= 42; half++) {
    ticks.push({ x: (half / 2) * PX_PER_CM, major: half % 2 === 0, cm: half / 2 });
  }

  return (
    <div className="ctcte-ruler" ref={barRef} style={{ width: SHEET_W }}>
      <div className="ctcte-ruler-pad" style={{ left: 0, width: margins.left }} />
      <div className="ctcte-ruler-pad" style={{ right: 0, width: margins.right }} />
      {ticks.map(t => (
        <span
          key={`t${t.x}`}
          className={`ctcte-ruler-tick${t.major ? ' is-major' : ''}`}
          style={{ left: t.x }}
        />
      ))}
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

function AnchoredPop({ anchor, width, onClose, children }: {
  anchor: HTMLElement | null;
  width: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [anchor, onClose]);

  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  let left = r.left;
  if (left + width > window.innerWidth - 8) left = r.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  return createPortal(
    <div ref={popRef} style={{ position: 'fixed', top: r.bottom + 6, left, zIndex: 400001 }}>
      {children}
    </div>,
    document.body,
  );
}

export function CtcToolbar({ editor, dark, hidePageBreak, hideColor, fonts = FONT_FAMILIES }: {
  editor: Editor | null;
  dark?: boolean;
  fonts?: { label: string; value: string }[];
  hidePageBreak?: boolean;
  hideColor?: boolean;
}) {
  const [, bumpToolbar] = useState(0);
  const toolbarSigRef = useRef('');
  useEffect(() => {
    if (!editor) return;
    const sign = () => [
      editor.isActive('bold'), editor.isActive('italic'), editor.isActive('underline'),
      editor.isActive('strike'), editor.isActive('superscript'), editor.isActive('subscript'),
      editor.isActive('link'), editor.isActive('bulletList'), editor.isActive('orderedList'),
      editor.isActive('listItem'), editor.isActive('table'),
      editor.isActive('heading', { level: 1 }), editor.isActive('heading', { level: 2 }),
      editor.isActive('heading', { level: 3 }),
      editor.isActive({ textAlign: 'left' }), editor.isActive({ textAlign: 'center' }),
      editor.isActive({ textAlign: 'right' }), editor.isActive({ textAlign: 'justify' }),
    ].map(Boolean).join('')
      + '|' + String(editor.getAttributes('textStyle').fontSize ?? '')
      + '|' + String(editor.getAttributes('textStyle').fontFamily ?? '');

    const sync = () => {
      const next = sign();
      if (next === toolbarSigRef.current) return;
      toolbarSigRef.current = next;
      bumpToolbar(n => n + 1);
    };

    sync();
    editor.on('transaction', sync);
    editor.on('selectionUpdate', sync);
    return () => {
      editor.off('transaction', sync);
      editor.off('selectionUpdate', sync);
    };
  }, [editor]);

  type ToolMenu = 'link' | 'spacing' | 'table' | 'find' | null;
  const [menu, setMenu] = useState<ToolMenu>(null);
  const spacingAnchorRef = useRef<HTMLDivElement>(null);
  const tableAnchorRef   = useRef<HTMLDivElement>(null);
  const linkAnchorRef = useRef<HTMLDivElement>(null);
  const findAnchorRef = useRef<HTMLDivElement>(null);
  const linkOpen    = menu === 'link';
  useEffect(() => {
    if (!editor || linkOpen) return;
    if (selShadowKey.getState(editor.state)) {
      editor.view.dispatch(editor.state.tr.setMeta(selShadowKey, null));
    }
  }, [linkOpen, editor]);
  const spacingOpen = menu === 'spacing';
  const tableOpen   = menu === 'table';
  const findOpen    = menu === 'find';
  const menuSetter = (name: Exclude<ToolMenu, null>) =>
    (v: boolean | ((prev: boolean) => boolean)) =>
      setMenu(prev => {
        const isOpen = prev === name;
        const next = typeof v === 'function' ? v(isOpen) : v;
        return next ? name : (isOpen ? null : prev);
      });
  const setLinkOpen    = menuSetter('link');
  const setSpacingOpen = menuSetter('spacing');
  const setTableOpen   = menuSetter('table');
  const setFindOpen    = menuSetter('find');
  const [findTerm, setFindTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const findVisited = useRef(false);
  const [linkUrl, setLinkUrl] = useState('');

  const findWasOpen = useRef(false);
  useEffect(() => {
    if (findOpen) { findWasOpen.current = true; return; }
    if (!findWasOpen.current || !editor) return;
    findWasOpen.current = false;

    let tr = editor.state.tr.setMeta(findKey, { term: '', matchCase: false, index: 0, matches: [] });
    if (!editor.state.selection.empty) {
      tr = tr.setSelection(TextSelection.create(tr.doc, editor.state.selection.to));
    }
    editor.view.dispatch(tr);
    findVisited.current = false;
  }, [findOpen, editor]);

  if (!editor) return null;

  const applyLink = () => {
    const raw = linkUrl.trim();
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkOpen(false); setLinkUrl('');
      return;
    }
    const url = /^(https?:\/\/|mailto:|tel:)/i.test(raw) ? raw : `https://${raw}`;
    const { from, to } = editor.state.selection;
    if (from === to) {
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

  const rawFontSize = String(editor.getAttributes('textStyle').fontSize || '');
  const curFontSize = rawFontSize.endsWith('px')
    ? String(Math.round(parseFloat(rawFontSize) * 0.75))
    : rawFontSize.replace('pt', '');
  const curFontFamily = String(editor.getAttributes('textStyle').fontFamily || fonts[0].value);
  const inTable = editor.isActive('table');

  const outerOrderedList = (): { pos: number; node: any } | null => {
    const $from = editor.state.selection.$from;
    let found: { pos: number; node: any } | null = null;
    for (let d = 1; d <= $from.depth; d++) {
      const n = $from.node(d);
      if (n.type.name === 'orderedList' && !found) found = { pos: $from.before(d), node: n };
    }
    return found;
  };
  const legalListOn = !!outerOrderedList()?.node.attrs.legal;
  const toggleLegalList = () => {
    if (!editor.isActive('orderedList')) {
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

  useEffect(() => {
    if (!editor || findOpen) return;
    const fs: FindState | undefined = findKey.getState(editor.state);
    if (!fs?.term && !fs?.matches?.length) return;
    const tr = editor.state.tr.setMeta(findKey, { term: '', matchCase, index: 0, matches: [] });

    const m = fs.matches?.[fs.index];
    const sel = editor.state.selection;
    if (m && !sel.empty && sel.from === m.from && sel.to === m.to) {
      tr.setSelection(TextSelection.create(tr.doc, m.to));
    }
    editor.view.dispatch(tr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, findOpen]);

  const findMatches: FindMatch[] = (findOpen && findTerm)
    ? collectMatches(editor.state.doc, findTerm, matchCase)
    : [];
  const findCount = findMatches.length;
  const findState: any = findKey.getState(editor.state);
  const findIndex = findCount ? Math.min(findState?.index ?? 0, findCount - 1) + 1 : 0;

  const pushSearch = (term: string, caseSensitive: boolean) => {
    const matches = term ? collectMatches(editor.state.doc, term, caseSensitive) : [];
    editor.view.dispatch(
      editor.state.tr.setMeta(findKey, { term, matchCase: caseSensitive, index: 0, matches }),
    );
    findVisited.current = false;
  };

  const stepMatch = (delta: number) => {
    if (!findMatches.length) return;
    const cur = Math.min(findKey.getState(editor.state)?.index ?? 0, findMatches.length - 1);
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

  const scrollToMatch = (pos: number) => {
    try {
      const at = editor.view.domAtPos(pos);
      const node: any = at?.node;
      const el: HTMLElement | null =
        node?.nodeType === 3 ? node.parentElement : (node as HTMLElement | null);
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    } catch {
    }
  };

  const replaceCurrent = () => {
    if (!findMatches.length) return;
    const cur = Math.min(findKey.getState(editor.state)?.index ?? 0, findMatches.length - 1);
    const m = findMatches[cur] ?? findMatches[0];
    editor.view.dispatch(editor.state.tr.insertText(replaceTerm, m.from, m.to));
  };

  const replaceAll = () => {
    if (!findMatches.length) return;
    const tr = editor.state.tr;
    for (let i = findMatches.length - 1; i >= 0; i--) {
      const m = findMatches[i];
      tr.insertText(replaceTerm, m.from, m.to);
    }
    editor.view.dispatch(tr);
  };

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

  const dressNewCells = () => {
    const { state, view } = editor;
    const $from = state.selection.$from;
    let table: { node: any; pos: number } | null = null;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'table') { table = { node: n, pos: $from.before(d) }; break; }
    }
    if (!table) return;

    const byKind: Record<string, string> = {};
    const byColumn: Record<string, string> = {};
    table.node.forEach((row: any) => {
      row.forEach((cell: any, _off: number, i: number) => {
        const style = cell.attrs.style;
        if (!style) return;
        if (!byKind[cell.type.name]) byKind[cell.type.name] = style;
        const col = cell.type.name + ':' + i;
        if (!byColumn[col]) byColumn[col] = style;
      });
    });

    const tr = state.tr;
    table.node.forEach((row: any, rowOff: number) => {
      const rowPos = table!.pos + 1 + rowOff;
      const inRow: Record<string, string> = {};
      row.forEach((cell: any) => {
        if (cell.attrs.style && !inRow[cell.type.name]) inRow[cell.type.name] = cell.attrs.style;
      });
      row.forEach((cell: any, cellOff: number, i: number) => {
        if (cell.attrs.style) return;
        const kind = cell.type.name;
        const model = inRow[kind] ?? byColumn[kind + ':' + i] ?? byKind[kind];
        if (!model) return;
        tr.setNodeMarkup(rowPos + 1 + cellOff, undefined, { ...cell.attrs, style: model });
      });
    });
    if (tr.docChanged) view.dispatch(tr);
  };
  const blockAttrs = Object.keys(editor.getAttributes('heading')).length
    ? editor.getAttributes('heading')
    : editor.getAttributes('paragraph');
  const curLineHeight = String(blockAttrs.lineHeight || '');
  const hasSpaceBefore = !!blockAttrs.spaceBefore;
  const hasSpaceAfter  = !!blockAttrs.spaceAfter;

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
      <TB active={editor.isActive('superscript')} onClick={() => editor.chain().focus().unsetSubscript().toggleSuperscript().run()} title="Superscript"><span style={{ fontSize: 11 }}>X²</span></TB>
      <TB active={editor.isActive('subscript')}   onClick={() => editor.chain().focus().unsetSuperscript().toggleSubscript().run()} title="Subscript"><span style={{ fontSize: 11 }}>X₂</span></TB>
      {!hideColor && (<>
      <label className="ctcte-btn ctcte-color" title="Text colour">
        <span style={{ borderBottom: `3px solid ${editor.getAttributes('textStyle').color || '#1f2937'}`, lineHeight: 1 }}>A</span>
        <input
          type="color"
          value={editor.getAttributes('textStyle').color || '#1f2937'}
          onChange={e => (editor.chain().focus() as any).setColor(e.target.value).run()}
        />
      </label>
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
      </>)}

      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <TB active={editor.isActive({ textAlign: 'left' })}    onClick={() => editor.chain().focus().setTextAlign('left').run()}    title="Align left"><Ico d="M3 6h18M3 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'center' })}  onClick={() => editor.chain().focus().setTextAlign('center').run()}  title="Align center"><Ico d="M3 6h18M6 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'right' })}   onClick={() => editor.chain().focus().setTextAlign('right').run()}   title="Align right"><Ico d="M3 6h18M9 12h12M3 18h18" /></TB>
      <TB active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify"><Ico d="M3 6h18M3 12h18M3 18h18" /></TB>

      <div className="ctcte-linkwrap" ref={spacingAnchorRef}>
        <button
          type="button"
          className={`ctcte-pgbtn${spacingOpen ? ' is-open' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setSpacingOpen(o => !o)}
          title={`Line and paragraph spacing${curLineHeight ? ` — ${curLineHeight}` : ''}`}
        >
          <Ico d="M9 5h12M9 12h12M9 19h12M4 4v16M4 4l-2 2.5M4 4l2 2.5M4 20l-2-2.5M4 20l2-2.5" />
          {curLineHeight && <span className="ctcte-btn-val">{curLineHeight}</span>}
        </button>
        {spacingOpen && (
          <>
            <div className="ctcte-spcbd" onMouseDown={e => { e.preventDefault(); setSpacingOpen(false); }} />
            <AnchoredPop anchor={spacingAnchorRef.current} width={232} onClose={() => setSpacingOpen(false)}>
            <div className="ctcte-spcpop ctcte-pop-portal" onMouseDown={e => e.preventDefault()}>
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
            </AnchoredPop>
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

      <TB
        active={legalListOn}
        onClick={toggleLegalList}
        title="Sub points (1.1, 1.1.1)"
      >
        <span className="ctcte-btn-txt">1.1</span>
      </TB>
      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <div className="ctcte-linkwrap" ref={linkAnchorRef}>
        <TB active={editor.isActive('link')} onClick={() => {
          const opening = !linkOpen;
          setLinkUrl(editor.getAttributes('link').href ?? '');
          const { from, to } = editor.state.selection;
          editor.view.dispatch(editor.state.tr.setMeta(selShadowKey, opening && to > from ? { from, to } : null));
          setLinkOpen(o => !o);
        }} title="Insert link"><Ico d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></TB>
        {linkOpen && (
          <AnchoredPop anchor={linkAnchorRef.current} width={280} onClose={() => setMenu(null)}>
          <div className="ctcte-linkpop ctcte-pop-portal" onMouseDown={e => e.preventDefault()}>
            <input autoFocus className="ctcte-linkinput" placeholder="https://…" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') setLinkOpen(false); }} />
            <button type="button" className="ctcte-linkbtn" onClick={applyLink}>Apply</button>
          </div>
          </AnchoredPop>
        )}
      </div>

      <div className="ctcte-linkwrap" ref={tableAnchorRef}>
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
            <AnchoredPop anchor={tableAnchorRef.current} width={232} onClose={() => setTableOpen(false)}>
            <div className="ctcte-spcpop ctcte-pop-portal" onMouseDown={e => e.preventDefault()}>
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
                ['Insert Row Above',    () => { editor.chain().focus().addRowBefore().run(); dressNewCells(); }],
                ['Insert Row Below',    () => { editor.chain().focus().addRowAfter().run(); dressNewCells(); }],
                ['Insert Column Left',  () => { editor.chain().focus().addColumnBefore().run(); dressNewCells(); }],
                ['Insert Column Right', () => { editor.chain().focus().addColumnAfter().run(); dressNewCells(); }],
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
            </AnchoredPop>
          </>
        )}
      </div>

      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
      <div className="ctcte-linkwrap" ref={findAnchorRef}>
        <button
          type="button"
          className={`ctcte-pgbtn${findOpen ? ' is-open' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            const next = !findOpen;
            setFindOpen(next);
            if (!next) { pushSearch('', matchCase); return; }

            const { from, to, empty } = editor.state.selection;
            const picked = empty ? '' : editor.state.doc.textBetween(from, to, ' ').trim();
            const seed = (picked && !picked.includes('\n') && picked.length <= 120) ? picked : findTerm;
            if (seed !== findTerm) setFindTerm(seed);
            if (seed) pushSearch(seed, matchCase);
          }}
          title="Find and replace"
        >
          <Ico d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.35-4.35" />
        </button>
        {findOpen && (
          <AnchoredPop anchor={findAnchorRef.current} width={340} onClose={() => setMenu(null)}>
          <div className="ctcte-findpop ctcte-pop-portal" onMouseDown={e => e.stopPropagation()}>
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
          </AnchoredPop>
        )}
      </div>
      </div>
      <span className="ctcte-div" />
      <div className="ctcte-grp">
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

export const CTC_EDITOR_CSS = `
.clm-editor-split { display: flex; flex: 1; min-height: 0; min-width: 0; }
@media (max-width: 1180px) {
  .clm-editor-split { flex-direction: column; }
  .clm-editor-split > * { width: auto !important; }
  .clm-editor-split > *:last-child { flex: 0 0 42%; min-height: 0; }
}
.ctcte-selshadow { background: rgba(124,58,237,.22); border-radius: 2px; }
.ctcte-toolbar { display: flex; align-items: center; gap: 3px; row-gap: 6px; flex-wrap: wrap; padding: 7px 10px; border-bottom: 1px solid #EDE9FE; background: #FAFBFF; flex-shrink: 0; }
.ctcte-toolbar > * { flex-shrink: 0; }
.ctcte-grp { display: flex; align-items: center; gap: 3px; flex-wrap: nowrap; flex-shrink: 0; height: 28px; }
.ctcte-grp:empty { display: none; }
.ctcte-div:first-child, .ctcte-div:last-child { display: none; }
.ctcte-sel { height: 28px; border: 1.5px solid #E5E1F3; border-radius: 8px; background: #fff; color: #4C1D95; font-family: inherit; font-size: 11px; font-weight: 600; padding: 0 8px; cursor: pointer; outline: none; }
.ctcte-sel-sm { min-width: 56px; padding: 0 6px; }
.ctcte-sel-fixed { appearance: none; -webkit-appearance: none; -moz-appearance: none; padding-right: 10px; text-align: left; }
.ctcte-sel-fixed::-ms-expand { display: none; }
.ctcte-pageview { will-change: transform; }

.ctcte-pageview { --pg-w: 744px; background: #EEF0F6; padding: 26px 0 34px; min-height: 100%; box-sizing: border-box; }
.ctcte-content.ctcte-pageview .ProseMirror {
  width: calc(794px - var(--pg-ml, 25px) - var(--pg-mr, 25px) - 50px);
  margin: 0 auto;
  padding: 43px calc(var(--pg-mr, 25px) + 25px) 110px calc(var(--pg-ml, 25px) + 25px);
  box-sizing: content-box;
  position: relative;
  background: #fff;
  font-size: 11px;
  line-height: 21.1px;
  font-family: 'Times New Roman', Times, serif;
  min-height: 852px;
  box-shadow: 0 0 0 1px rgba(16,24,40,.05), 0 2px 5px rgba(16,24,40,.10), 0 12px 28px rgba(16,24,40,.07);
}
.ctcte-content.ctcte-pageview .ProseMirror p,
.ctcte-content.ctcte-pageview .ProseMirror div { margin: 0 0 8px; line-height: 21.1px; }
.ctcte-content.ctcte-pageview .ProseMirror h1,
.ctcte-content.ctcte-pageview .ProseMirror h2,
.ctcte-content.ctcte-pageview .ProseMirror h3 {
  margin: 14px 0 8px;
  font-family: 'Times New Roman', Times, serif;
}
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
.ctcte-content.ctcte-pageview .ProseMirror ol { margin: 0 0 8px 0; padding-left: 1.6em; }
.ctcte-content .ProseMirror strong,
.ctcte-content .ProseMirror b { font-weight: 700; }
.ctcte-content .ProseMirror em,
.ctcte-content .ProseMirror i { font-style: italic; }
.ctcte-content .ProseMirror ul,
.tpl-editor-surface .ProseMirror ul       { list-style: disc outside; }
.ctcte-content .ProseMirror ul ul,
.tpl-editor-surface .ProseMirror ul ul    { list-style: circle outside; }
.ctcte-content .ProseMirror ul ul ul,
.tpl-editor-surface .ProseMirror ul ul ul { list-style: square outside; }
.ctcte-content .ProseMirror ol,
.tpl-editor-surface .ProseMirror ol       { list-style: decimal outside; }
.ctcte-content .ProseMirror ol ol,
.tpl-editor-surface .ProseMirror ol ol    { list-style: lower-alpha outside; }
.ctcte-content .ProseMirror ol ol ol,
.tpl-editor-surface .ProseMirror ol ol ol { list-style: lower-roman outside; }
.tpl-editor-surface .ProseMirror ul,
.tpl-editor-surface .ProseMirror ol { margin: 0 0 8px 0; padding-left: 1.6em; }
.ctcte-content.ctcte-pageview .ProseMirror li { line-height: 21.1px; }
.ctcte-content.ctcte-pageview .ProseMirror table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ctcte-content.ctcte-pageview .ProseMirror table td,
.ctcte-content.ctcte-pageview .ProseMirror table th {
  padding: 6px 8px; vertical-align: top;
  word-wrap: break-word; overflow-wrap: break-word; word-break: break-word;
}
.ctcte-content.ctcte-pageview .ProseMirror table p { margin: 0; }
.ctcte-content .ProseMirror table { position: relative; max-width: 100%; }

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
.ctcte-content .ProseMirror ol[data-legal] li > p:first-of-type {
  display: inline;
  margin: 0;
}
.ctcte-content .ProseMirror ol[data-legal] li > ol { display: block; }
.ProseMirror .column-resize-handle {
  position: absolute; right: -2px; top: 0; bottom: 0; width: 4px;
  background: #7C3AED; pointer-events: none; z-index: 20;
}
.ProseMirror.resize-cursor { cursor: col-resize; }
.ProseMirror th, .ProseMirror td { position: relative; }
.ProseMirror .selectedCell::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: rgba(124,58,237,.14);
}
.ctcte-content.ctcte-pageview .ProseMirror table td:not([style*="border"]),
.ctcte-content.ctcte-pageview .ProseMirror table th:not([style*="border"]) {
  outline: 1px dashed #D8DEE9; outline-offset: -1px;
}

@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Bold.ttf') format('truetype'); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-Oblique.ttf') format('truetype'); font-weight: 400; font-style: italic; font-display: swap; }
@font-face { font-family: 'DejaVu Sans'; src: url('/fonts/DejaVuSans-BoldOblique.ttf') format('truetype'); font-weight: 700; font-style: italic; font-display: swap; }

.ctcte-ruler {
  position: relative; height: 26px; margin: 0 auto 10px;
  background: #fff; border: 1px solid #E3E6EF; border-radius: 4px;
  box-shadow: 0 1px 2px rgba(16,24,40,.05);
  user-select: none;
}
.ctcte-ruler-pad { position: absolute; top: 0; bottom: 0; background: #E6E9F2; }
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

.ctcte-spanmarks { position: absolute; inset: 0 0 auto 0; height: 0; pointer-events: none; z-index: 2; }

.ctcte-pageline, .ctcte-spanmark {
  position: absolute; height: 0;
  left: calc((var(--pg-ml, 25px) + 25px) * -1);
  right: calc((var(--pg-mr, 25px) + 25px) * -1);
}
.ctcte-pageline { border-top: 1px solid #CFD5E2; box-shadow: 0 4px 8px -6px rgba(16,24,40,.45); }
.ctcte-spanmark { border-top: 1px dashed #D3D8E3; }
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

.ctcte-pagegap { margin: 0 calc((var(--pg-mr, 25px) + 25px) * -1) 0 calc((var(--pg-ml, 25px) + 25px) * -1); user-select: none; }
.ctcte-pagegap-row > td { padding: 0 !important; border: none !important; user-select: none; }

[data-bs-theme="dark"] .ctcte-content.ctcte-pageview .ProseMirror { background: #1b2028; color: #e5e7eb; }
[data-bs-theme="dark"] .ctcte-pagegap { background: #12151c; border-color: #2a3140; }
[data-bs-theme="dark"] .ctcte-content.ctcte-pageview { background: #12151c; }

.ctcte-pgtop::after,
.ctcte-pagegap::after,
.ctcte-pagegap-row > td::after,
.ctcte-pageline::after,
.ctcte-spanmark::after { content: none !important; display: none !important; }
.ctcte-pgtop::before,
.ctcte-pagegap::before,
.ctcte-pagegap-row > td::before { border-top: none !important; box-shadow: none !important; }
.ctcte-pageline,
.ctcte-spanmark { border-top: none !important; box-shadow: none !important; }

.ctcte-pgbtn { height: 26px; padding: 0 9px; border: 1.5px solid #DDD6FE; border-radius: 7px; background: #F5F3FF; color: #6D28D9; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; transition: background .12s, border-color .12s; }
.ctcte-pgbtn:not(.ctcte-pgbtn-label) { padding: 0 6px; }
.ctcte-btn-val { font-size: 9.5px; font-weight: 800; letter-spacing: -.02em; }
.ctcte-btn-txt { font-size: 10px; font-weight: 800; letter-spacing: -.02em; }
.ctcte-findpop.ctcte-pop-right,
.ctcte-spcpop.ctcte-pop-right { left: auto; right: 0; }
.ctcte-pop-portal { position: static !important; top: auto !important; left: auto !important; right: auto !important; margin: 0 !important; }
.ctcte-pgbtn:hover { background: #EDE9FE; border-color: #C4B5FD; }
[data-bs-theme="dark"] .ctcte-pgbtn { background: rgba(124,58,237,.18); border-color: rgba(124,58,237,.45); color: #C4B5FD; }
.ctcte-div { width: 1px; height: 28px; background: transparent; margin: 0 3px; display: flex; align-items: center; }
.ctcte-div::before { content: ''; display: block; width: 1px; height: 18px; background: #E5E1F3; }
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
.ctcte-find-hit { background: #FEF08A; }
.ctcte-find-cur { background: #FB923C; color: #fff; }
[data-bs-theme="dark"] .ctcte-findpop { background: #1b2230; border-color: rgba(124,58,237,.35); }
[data-bs-theme="dark"] .ctcte-findcase { color: #DDD6FE; }
.ctcte-pgbtn.is-open { background: #EDE9FE; border-color: #C4B5FD; }
.ctcte-spcbd { position: fixed; inset: 0; z-index: 59; }
.ctcte-spcpop {
  position: absolute; top: 32px; left: 0; z-index: 60; min-width: 232px;
  padding: 5px; background: #fff; border: 1.5px solid #DDD6FE; border-radius: 10px;
  box-shadow: 0 12px 30px rgba(109,40,217,.2);
  display: flex; flex-direction: column;
  max-height: min(58vh, 420px);
  overflow-y: auto;
  overscroll-behavior: contain;
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
[data-bs-theme="dark"] .ctcte-sel { background: #241a3d; border-color: rgba(124,58,237,.45); color: #ddd2ff; color-scheme: dark; }
[data-bs-theme="dark"] .ctcte-sel option { background: #241a3d; color: #ddd2ff; }
[data-bs-theme="dark"] .ctcte-sel:hover { border-color: rgba(167,139,250,.65); }
[data-bs-theme="dark"] .ctcte-sel:focus { outline: none; border-color: #a78bfa; }
[data-bs-theme="dark"] .ctcte-div { background: transparent; }
[data-bs-theme="dark"] .ctcte-div::before { background: rgba(124,58,237,.3); }
[data-bs-theme="dark"] .ctcte-btn { color: #c4b5fd; }
[data-bs-theme="dark"] .ctcte-btn:hover { background: rgba(124,58,237,.18); }
[data-bs-theme="dark"] .ctcte-content .ProseMirror { color: #e8eaed; }
[data-bs-theme="dark"] .ctcte-content .ProseMirror li::marker { color: #e8eaed; }
[data-bs-theme="dark"] .ctcte-content .ProseMirror ol[data-legal] li::before { color: #e8eaed; }
[data-bs-theme="dark"] .ctcte-linkpop { background: #1b2230; border-color: rgba(124,58,237,.35); }
[data-bs-theme="dark"] .ctcte-linkinput { background: rgba(255,255,255,.05); border-color: rgba(124,58,237,.3); color: #e8eaed; }
`;
