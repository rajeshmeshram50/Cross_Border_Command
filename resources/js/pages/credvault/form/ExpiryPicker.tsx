import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Svg } from '../shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const POPUP_W = 260;

function parse(v: string): { m: number; y: number } | null {
  const r = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(v.trim());
  return r ? { m: Number(r[1]) - 1, y: 2000 + Number(r[2]) } : null;
}

export default function ExpiryPicker({ id, value, placeholder, className, onChange, onBlur }: {
  id?: string; value: string; placeholder?: string; className: string;
  onChange: (v: string) => void; onBlur?: () => void;
}) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => parse(value)?.y ?? now.getFullYear());
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const picked = parse(value);

  const toggle = () => {
    if (!open) setYear(parse(value)?.y ?? now.getFullYear());
    setOpen(o => !o);
  };

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) { setPos(null); return; }
    const place = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - POPUP_W - 8));
      const h = popRef.current?.offsetHeight || 230;
      setPos(window.innerHeight - r.bottom - 13 >= h || r.top < h ? { top: r.bottom + 5, left } : { bottom: window.innerHeight - r.top + 5, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const scroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);

  const pick = (m: number) => {
    onChange(`${String(m + 1).padStart(2, '0')}/${String(year % 100).padStart(2, '0')}`);
    setOpen(false);
  };
  const past = (m: number) => year < now.getFullYear() || (year === now.getFullYear() && m < now.getMonth());

  return (
    <div ref={wrapRef} className="crd-exp">
      <button type="button" data-h40="skip" className={`mapsup-input-ico crd-exp__btn${open ? ' is-open' : ''}`}
        aria-label="Pick the expiry month and year" aria-expanded={open} onClick={toggle}>
        <Svg icon="cal" size={13} />
      </button>
      <input id={id} type="text" className={className} value={value} placeholder={placeholder}
        maxLength={5} inputMode="numeric" autoComplete="off" onChange={e => onChange(e.target.value)} onBlur={onBlur}
        onClick={() => { if (!open) toggle(); }} />

      {open && pos && createPortal(
        <div ref={popRef} className="master-datepicker-popup crd-cal crd-exp__pop" role="dialog" aria-label="Expiry month and year"
          style={{ position: 'fixed', top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto', left: pos.left, width: POPUP_W, backgroundColor: '#ffffff', backgroundImage: 'none', opacity: 1 }}>
          <div className="d-flex align-items-center justify-content-between mb-1">
            <button type="button" className="master-datepicker-nav" title="Previous year"
              disabled={year <= now.getFullYear()} onClick={() => setYear(y => y - 1)}>
              <i className="ri-arrow-left-s-line" style={{ fontSize: 13 }} />
            </button>
            <span className="master-datepicker-title-btn">{year}</span>
            <button type="button" className="master-datepicker-nav" title="Next year"
              disabled={year >= now.getFullYear() + 20} onClick={() => setYear(y => y + 1)}>
              <i className="ri-arrow-right-s-line" style={{ fontSize: 13 }} />
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '4px 0' }}>
            {MONTHS.map((label, m) => {
              const sel = !!picked && picked.y === year && picked.m === m;
              const cur = year === now.getFullYear() && m === now.getMonth();
              return (
                <button key={label} type="button" disabled={past(m)} onClick={() => pick(m)}
                  className={['master-datepicker-cell', sel && 'is-selected', !sel && cur && 'is-today'].filter(Boolean).join(' ')}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
