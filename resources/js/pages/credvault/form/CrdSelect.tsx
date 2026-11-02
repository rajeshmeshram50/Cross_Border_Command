import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Svg } from '../shared';

export interface CrdOption { value: string; label: string; dot?: string }

/**
 * The prototype's themed dropdown (crdEnhanceSelects / crdDdOpen): a trigger
 * that looks like the inputs and a floating list. `dot` paints the risk dot.
 */
export default function CrdSelect({ id, value, options, onChange, placeholder = 'Select…', disabled }: {
  id?: string; value: string; options: CrdOption[]; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const cur = options.find(o => o.value === value);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(pop.current?.scrollHeight ?? 280, 280);
    const below = window.innerHeight - r.bottom - 12;
    setPos({ left: r.left, width: r.width, top: below >= h || below > r.top ? r.bottom + 6 : r.top - 6 - h });
    pop.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    // The list is fixed to the viewport: close it rather than leave it behind when the form scrolls.
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    // Esc closes just the list: window capture runs ahead of the form's and the portal's Esc handlers.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    };
    window.addEventListener('keydown', esc, true);
    document.addEventListener('mousedown', out, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      window.removeEventListener('keydown', esc, true);
      document.removeEventListener('mousedown', out, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} id={id} type="button" data-h40="skip" disabled={disabled}
        className={`mapsup-finput has-ico crd-dd${open ? ' is-open' : ''}`}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={disabled ? { opacity: .6, cursor: 'not-allowed' } : undefined}>
        <span className={`crd-dd__v${cur && cur.value !== '' ? '' : ' is-ph'}`}>{cur ? cur.label : placeholder}</span>
        <span className="crd-dd__chev"><Svg d='<path d="M6 9l6 6 6-6"/>' size={14} sw={2.6} /></span>
      </button>
      {open && (
        <div ref={pop} className="crd-ddpop" role="listbox"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }}>
          {options.map(o => (
            <div key={o.value} role="option" aria-selected={o.value === value}
              className={`crd-ddpop__o${o.value === value ? ' is-sel' : ''}${o.value === '' ? ' is-ph' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              {o.dot && <i className={`crd-ddpop__dot crd-ddpop__dot--${o.dot}`} />}
              <span>{o.label}</span>
              <span className="crd-ddpop__tick"><Svg icon="check" size={12} sw={3} /></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
