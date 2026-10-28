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
  code: string;
  name: string;
  kind: SupplierKind;
  segment: string;
  location: string;
  risk: 'Low Risk' | 'Medium Risk' | 'High Risk';
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

export default function DirectSpiSupplierPicker({ rows, value, onPick }: {
  rows: SupplierRow[];
  value: string | null;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const trigRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const picked = rows.find(r => r.code === value) ?? null;
  const hit = q.trim().toLowerCase();
  const shown = hit
    ? rows.filter(r => `${r.code} ${r.name} ${r.segment} ${r.location} ${r.risk} ${KIND_LABEL[r.kind]}`.toLowerCase().includes(hit))
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
            {shown.length === 0 ? (
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
                      <span className="sdx-sup__c"><span className="sdx-sup__cl">Segment</span><span className="sdx-sup__cv">{r.segment}</span></span>
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
