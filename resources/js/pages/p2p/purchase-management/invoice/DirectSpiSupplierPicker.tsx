import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './direct-spi-steps.css';
import './direct-spi-supplier.css';

/**
 * The supplier picker for step 03 — a wider row than the other two lists.
 *
 * A supplier is chosen on more than its name: the same company can appear as
 * a manufacturer and a trader, and risk decides whether it may be used at all.
 * So the row carries its code, segment, location and risk in a grid under the
 * name, which is what the design shows and what a plain select cannot.
 */

export type SupplierKind = 'manufacturer' | 'trader' | 'service';

export interface SupplierRow {
  id?: number;
  code: string;
  name: string;
  kind: SupplierKind;
  /** One segment or several. A comma-separated string counts as several. */
  segment: string | string[];
  location: string;
  risk: string;
}

/* A supplier can trade in more than one segment, and the cell only had room
   for the word it was given — a second segment would have widened the column
   or been silently lost. Both shapes are accepted because the field is a
   plain string wherever it comes from a master today, and a supplier carrying
   two of them there will arrive comma-separated rather than as an array. */
export const segmentsOf = (r: SupplierRow): string[] =>
  (Array.isArray(r.segment) ? r.segment : r.segment.split(','))
    .map(s => s.trim())
    .filter(Boolean);

/* The panel the "+N" opens: wide enough for a segment name, short enough that
   it never becomes the thing you are reading instead of the list of suppliers.
   Both are needed before it is drawn, to decide which side of the pill it goes
   on and how far from the right edge it may start. */
const SEG_POP_W = 236;
const SEG_POP_H = 180;

/* The first segment, then "+N" for the rest — the same shape the app's other
   multi-value cells use, so the column stays one line wide however many
   segments a supplier carries.

   The "+N" opens the full list on a click. It used to be a `title` and nothing
   else: a native tooltip is slow to appear, cannot be reached from the
   keyboard, and on a count the whole point of which is "there is more here"
   that made the extra segments effectively unreadable. Same behaviour as
   SegmentTags in bulk-sourcing — its styling is scoped to another screen's
   table, so only the pattern is shared, not the markup. */
function SegmentCell({ row }: { row: SupplierRow }) {
  const all = segmentsOf(row);
  const [at, setAt] = useState<{ x: number; y: number; flip: boolean } | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    /* Capture, so a scroll of the picker's own list closes it too: the pill
       travels with its row while the panel is pinned to the viewport, and a
       panel left behind would be pointing at the wrong supplier. */
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [at]);

  if (all.length === 0) return <span className="sdx-sup__cv">—</span>;
  const [first, ...rest] = all;
  return (
    <span className="sdx-sup__cv sdx-sup__seg">
      <span className="sdx-sup__seg1" title={first}>{first}</span>
      {rest.length > 0 && (
        <button
          type="button"
          className="sdx-sup__segmore"
          aria-expanded={!!at}
          title={at ? 'Hide the segments' : `Show all ${all.length} segments`}
          /* The row under this pill picks the supplier. Asking what the other
             two segments are is not choosing the company that trades in
             them, so neither press reaches it — and mousedown has to be
             stopped as well as click, or the document listener above closes
             the panel in the same gesture that opened it. */
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            e.preventDefault();
            if (at) { setAt(null); return; }
            const b = e.currentTarget.getBoundingClientRect();
            setAt({
              x: Math.max(8, Math.min(b.left, window.innerWidth - SEG_POP_W - 8)),
              /* Below the pill unless that would run off the bottom — near
                 the foot of a long supplier list, it always would. */
              flip: b.bottom + 6 + SEG_POP_H > window.innerHeight,
              y: b.bottom + 6 + SEG_POP_H > window.innerHeight ? b.top - 6 : b.bottom + 6,
            });
          }}
        >+{rest.length}</button>
      )}
      {at && createPortal(
        <div
          className="sdx-segpop"
          style={{ left: at.x, top: at.y, transform: at.flip ? 'translateY(-100%)' : undefined }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="sdx-segpop__hd">Segments ({all.length})</div>
          <div className="sdx-segpop__list">
            {all.map(s => <span key={s} className="sdx-segpop__item">{s}</span>)}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

const KIND_LABEL: Record<SupplierKind, string> = {
  manufacturer: 'Manufacturer', trader: 'Trader', service: 'Service Provider',
};

/* Initials from the first two words — "Reliance Industries Ltd" gives RI, not
   RIL: the legal suffix is on every name and tells them apart from nothing. */
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(w => !/^(ltd|limited|pvt|private|inc|llp|co)\.?$/i.test(w))
    .slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');

const IcoSearch = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IcoChev = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IcoTick = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function DirectSpiSupplierPicker({ rows, value, onPick, loading = false, error = null, onRetry, pickedRow = null }: {
  rows: SupplierRow[];
  value: string | null;
  onPick: (code: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pickedRow?: { code: string; name: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const trigRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const picked = rows.find(r => r.code === value) ?? pickedRow;
  const hit = q.trim().toLowerCase();
  const shown = hit
    /* segmentsOf, not r.segment: the hidden ones behind "+N" have to be
       searchable, or a supplier is unfindable by a segment it actually
       trades in — and the array shape would otherwise stringify with
       commas and no spaces, which breaks a two-word match across the join. */
    ? rows.filter(r => `${r.code} ${r.name} ${segmentsOf(r).join(' ')} ${r.location} ${r.risk} ${KIND_LABEL[r.kind]}`.toLowerCase().includes(hit))
    : rows;

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const t = trigRef.current?.getBoundingClientRect();
      if (!t) return;
      const H = Math.min(360, 52 + shown.length * 86);
      const below = window.innerHeight - t.bottom - 12;
      const above = t.top - 12;
      const flip = below < H && above > below;
      setPos({
        left: Math.max(12, Math.min(t.left, window.innerWidth - t.width - 12)),
        top: flip ? Math.max(12, t.top - 6 - H) : t.bottom + 6,
        width: t.width,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, shown.length]);

  useEffect(() => {
    if (!open) return;
    /* A segment panel is opened FROM this popover but portalled to the body,
       so it is not inside `popRef` and both handlers below would treat using
       it as leaving — clicking a segment would shut the picker, and Escape
       would shut the picker rather than the panel. Neither is what the press
       meant, so the panel is checked for by its class: it belongs to a row of
       this list, whatever it is parented to. */
    const inSegPop = (n: Node | null) =>
      !!(n instanceof Element ? n : n?.parentElement)?.closest('.sdx-segpop');
    const out = (e: MouseEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || trigRef.current?.contains(n) || inSegPop(n)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* Let the open panel take this one. It closes on Escape itself, and
         propagation is deliberately not stopped so that listener still runs. */
      if (document.querySelector('.sdx-segpop')) return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', out, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', out, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={trigRef}
        className={`sdx-trig sdx-trig--sup${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setQ(''); }}
      >
        {picked ? (
          <>
            <span className="sdx-sup__code">{picked.code}</span>
            <span className="sdx-sup__name">{picked.name}</span>
          </>
        ) : (
          <span className="sdx-trig__ph">Select a supplier…</span>
        )}
        <span className="sdx-trig__chev">{IcoChev}</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          className="sdx-pop sdx-pop--sup"
          role="listbox"
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: 360 }}
        >
          <div className="sdx-pop__search">
            {IcoSearch}
            <input
              autoFocus
              autoComplete="off"
              placeholder="Search supplier, code, segment, state…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <div className="sdx-pop__list">
            {loading ? (
              <div className="sdx-pop__none"><span className="spi-btn-spin" aria-hidden />Loading suppliers…</div>
            ) : error ? (
              <div className="sdx-pop__none">
                {error}
                {onRetry && <> <button type="button" className="sdx-pop__retry" onClick={onRetry}>Retry</button></>}
              </div>
            ) : rows.length === 0 ? (
              <div className="sdx-pop__none">No suppliers found.</div>
            ) : shown.length === 0 ? (
              <div className="sdx-pop__none">No supplier matches “{q.trim()}”.</div>
            ) : shown.map(r => {
              const on = r.code === value;
              return (
                <div
                  key={r.code}
                  role="option"
                  aria-selected={on}
                  className={`sdx-sup__opt${on ? ' is-sel' : ''}`}
                  onClick={() => { onPick(r.code); setOpen(false); }}
                >
                  <span className={`sdx-sup__av sdx-sup__av--${r.kind}`}>{initialsOf(r.name)}</span>
                  <span className="sdx-sup__main">
                    <span className="sdx-sup__hd">
                      <span className="sdx-sup__nm">{r.name}</span>
                      <span className={`sdx-sup__kind sdx-sup__kind--${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                      <span className="sdx-sup__tick">{IcoTick}</span>
                    </span>
                    {/* Code, segment, location and risk together — the four
                        facts that decide whether this is the right supplier,
                        rather than one line that makes you open the master to
                        find out. */}
                    <span className="sdx-sup__grid">
                      <span className="sdx-sup__c"><span className="sdx-sup__cl">Supplier Code</span><span className="sdx-sup__cv is-mono">{r.code}</span></span>
                      <span className="sdx-sup__c"><span className="sdx-sup__cl">Segment</span><SegmentCell row={r} /></span>
                      <span className="sdx-sup__c"><span className="sdx-sup__cl">Location</span><span className="sdx-sup__cv">{r.location}</span></span>
                      <span className="sdx-sup__c">
                        <span className="sdx-sup__cl">Risk</span>
                        <span className={`sdx-sup__cv sdx-risk--${r.risk.split(' ')[0].toLowerCase()}`}>{r.risk}</span>
                      </span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
