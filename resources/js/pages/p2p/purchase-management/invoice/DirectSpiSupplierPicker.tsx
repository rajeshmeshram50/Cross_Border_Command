import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from '../../../../components/ui/Tooltip';
import './direct-spi-steps.css';
import './direct-spi-supplier.css';

export type SupplierKind = 'manufacturer' | 'trader' | 'service';

export interface SupplierRow {
  id?: number;
  docType?: string | null;
  code: string;
  name: string;
  kind: SupplierKind;
  segment: string | string[];
  location: string;
  risk: string;
}

export const segmentsOf = (r: SupplierRow): string[] =>
  (Array.isArray(r.segment) ? r.segment : r.segment.split(','))
    .map(s => s.trim())
    .filter(Boolean);

const SEG_POP_W = 236;
const SEG_POP_H = 180;

function SegmentCell({ row }: { row: SupplierRow }) {
  const all = segmentsOf(row);
  const [at, setAt] = useState<{ x: number; y: number; flip: boolean } | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
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
          onMouseDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            e.preventDefault();
            if (at) { setAt(null); return; }
            const b = e.currentTarget.getBoundingClientRect();
            setAt({
              x: Math.max(8, Math.min(b.left, window.innerWidth - SEG_POP_W - 8)),
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

const NAME_MAX = 35;
const clipName = (s: string) =>
  s.length > NAME_MAX ? `${s.slice(0, NAME_MAX).trimEnd()}…` : s;

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
    const inSegPop = (n: Node | null) =>
      !!(n instanceof Element ? n : n?.parentElement)?.closest('.sdx-segpop');
    const out = (e: MouseEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || trigRef.current?.contains(n) || inSegPop(n)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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
                      <Tooltip label={r.name} disabled={r.name.length <= NAME_MAX}>
                        <span className="sdx-sup__nm">{clipName(r.name)}</span>
                      </Tooltip>
                      <span className={`sdx-sup__kind sdx-sup__kind--${r.kind}`}>{KIND_LABEL[r.kind]}</span>
                      <span className="sdx-sup__tick">{IcoTick}</span>
                    </span>
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
