import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './direct-spi-steps.css';

export interface PickRow {
  code: string;
  title: string;
  sub: string;
  tag?: { text: string; tone: 'goods' | 'ffd' | 'service' };
}

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

const TYPE_ICO: Record<'goods' | 'ffd' | 'service', ReactNode> = {
  goods: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    </svg>
  ),
  ffd: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="6" width="14" height="11" rx="1.5" /><path d="M15 9h4l3 3v5h-7z" />
      <circle cx="6" cy="19" r="1.6" /><circle cx="17.5" cy="19" r="1.6" />
    </svg>
  ),
  service: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
};

function TypeChip({ tag }: { tag: NonNullable<PickRow['tag']> }) {
  return <span className={`sdx-ptype sdx-ptype--${tag.tone}`}>{TYPE_ICO[tag.tone]}{tag.text}</span>;
}

export default function DirectSpiPicker({
  rows, value, onPick, placeholder, noun, ico, popIco, searchPlaceholder,
  loading = false, error = null, onRetry, pickedRow = null,
}: {
  rows: PickRow[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pickedRow?: PickRow | null;
  value: string | null;
  onPick: (code: string) => void;
  placeholder: string;
  noun: string;
  ico: ReactNode;
  popIco: (r: PickRow) => ReactNode;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const trigRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const picked = rows.find(r => r.code === value) ?? pickedRow;
  const hit = q.trim().toLowerCase();
  const shown = hit
    ? rows.filter(r => `${r.code} ${r.title} ${r.sub} ${r.tag?.text ?? ''}`.toLowerCase().includes(hit))
    : rows;

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const t = trigRef.current?.getBoundingClientRect();
      if (!t) return;
      const H = Math.min(320, 56 + shown.length * 56);
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
    const out = (e: MouseEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || trigRef.current?.contains(n)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
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
        className={`sdx-trig${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen(o => !o); setQ(''); }}
      >
        {picked ? (
          <>
            <span className="sdx-trig__code">{picked.code}</span>
            <span className="sdx-trig__main">
              <b>{picked.title}</b>
              {picked.sub && <small>{picked.sub}</small>}
            </span>
            {picked.tag && <TypeChip tag={picked.tag} />}
          </>
        ) : (
          <span className="sdx-trig__ph">{ico}{placeholder}</span>
        )}
        <span className="sdx-trig__chev">{IcoChev}</span>
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          className="sdx-pop"
          role="listbox"
          style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: 320 }}
        >
          <div className="sdx-pop__search">
            {IcoSearch}
            <input
              autoFocus
              autoComplete="off"
              placeholder={searchPlaceholder}
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <span className="sdx-pop__count">{loading ? '…' : shown.length} {noun}</span>
          </div>
          <div className="sdx-pop__list">
            {loading ? (
              <div className="sdx-pop__none"><span className="spi-btn-spin" aria-hidden />Loading {noun}…</div>
            ) : error ? (
              <div className="sdx-pop__none">
                {error}
                {onRetry && <> <button type="button" className="sdx-pop__retry" onClick={onRetry}>Retry</button></>}
              </div>
            ) : rows.length === 0 ? (
              <div className="sdx-pop__none">No {noun} found.</div>
            ) : shown.length === 0 ? (
              <div className="sdx-pop__none">Nothing matches “{q.trim()}”.</div>
            ) : shown.map(r => {
              const on = r.code === value;
              return (
                <div
                  key={r.code}
                  role="option"
                  aria-selected={on}
                  className={`sdx-pop__opt${on ? ' is-sel' : ''}`}
                  onClick={() => { onPick(r.code); setOpen(false); }}
                >
                  <span className={`sdx-pop__ico${r.tag ? ` sdx-pop__ico--${r.tag.tone}` : ''}`}>{popIco(r)}</span>
                  <span className="sdx-pop__main">
                    <span className="sdx-pop__row">
                      <span className="sdx-pop__code">{r.code}</span>
                      <b>{r.title}</b>
                    </span>
                    {r.sub && <small>{r.sub}</small>}
                  </span>
                  {r.tag && <TypeChip tag={r.tag} />}
                  <span className="sdx-pop__tick">{IcoTick}</span>
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
