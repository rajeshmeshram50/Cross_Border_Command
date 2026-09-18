/* ─────────────────────────────────────────────────────────────────────────
 * Create PO form controls — label + field, and the styled dropdown.
 *
 * They wear the shared P2P wizard classes (spi-dt-*) so the form matches the
 * rest of P2P, but the components belong to this form only.
 * ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import SegmentBadge from '../../../../../components/ui/SegmentBadge';
import Tooltip from '../../../../../components/ui/Tooltip';

/* Extra information an option can carry: product code, segment, badges. */
export type DdMeta = { code?: string; badge?: string; tone?: 'own' | 'third'; segment?: string; segReg?: string; disabled?: boolean };

/* Normalise a product code so the trailing number is always 3 digits
   (P-06 → P-006, P-1 → P-001) — matches the Product Management display. */
export function formatProductCode(raw: string): string {
  const m = raw.match(/^(.*?)(\d+)\s*$/);
  if (!m) return raw;
  return `${m[1] || 'P-'}${m[2].padStart(3, '0')}`;
}

/* Label + control, one cell of a wizard field grid. */
export function Field({ label, children, full, req }: { label: string; children: ReactNode; full?: boolean; req?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>{children}</div>;
}

/* Render an option label, optionally with a code prefix + own/third badge. */
function eselLabel(o: string, m?: DdMeta) {
  if (!m) return <span>{o}</span>;
  return (
    <span className="spi-dt-esel-lbl">
      {m.code && <span className="spi-dt-esel-code">{formatProductCode(m.code)}:</span>}
      <span className="spi-dt-esel-name" title={o}>{o}</span>
      {m.segment && <span className="spi-dt-esel-seg">{m.segment}</span>}
      {m.segReg && <SegmentBadge status={m.segReg} style={{ marginLeft: 4, flexShrink: 0 }} />}
      {m.badge && <span className={`spi-dt-esel-badge spi-dt-esel-badge--${m.tone || 'own'}`}>{m.badge}</span>}
      {m.disabled && <span className="spi-dt-esel-lock">Segment not mapped</span>}
    </span>
  );
}

/* Editable styled dropdown. The popup is portalled to <body> so the section
   card's overflow:hidden can't clip it. */
export function EditSelect({ value, options, onChange, placeholder, meta, invalid, onDisabledSelect }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; meta?: Record<string, DdMeta>; invalid?: boolean; onDisabledSelect?: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  // Position under the button, flipping up if it would overflow the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = Math.min(224, Math.max(options.length, 1) * 38 + 10);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.spi-dt-esel-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // A scroll INSIDE the dropdown's own option list must not close it — else
    // the list snaps shut the moment you wheel-scroll it (no smooth scrolling).
    // Only scrolls in an ancestor (page / panel) should dismiss the menu.
    const close = (e?: Event) => {
      const el = e && e.target instanceof Element ? e.target : null;
      if (el && el.closest('.spi-dt-esel-pop')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <Tooltip label={value} disabled={!value} position="bottom" zIndex={2999999}>
        <button type="button" ref={btnRef} className={`spi-dt-select spi-dt-select-edit ${open ? 'is-open' : ''} ${!value ? 'is-muted' : ''} ${invalid ? 'is-invalid' : ''}`} onClick={() => setOpen(o => !o)}>
          <span>{value ? eselLabel(value, meta?.[value]) : (placeholder || '— Select —')}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
      </Tooltip>
      {open && createPortal(
        <div className="spi-dt-esel-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.map(o => {
            const dis = !!meta?.[o]?.disabled;
            return (
              <div
                key={o}
                className={`spi-dt-esel-opt ${o === value ? 'is-active' : ''} ${dis ? 'is-disabled' : ''}`}
                aria-disabled={dis}
                onClick={() => { if (dis) { onDisabledSelect?.(o); return; } onChange(o); setOpen(false); }}
              >{eselLabel(o, meta?.[o])}</div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
