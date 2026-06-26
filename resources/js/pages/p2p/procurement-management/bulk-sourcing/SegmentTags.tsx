import { useEffect, useRef, useState } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';

/* SegmentTags — renders a supplier's segments compactly.
 * `segment` is a comma-separated string (e.g. "Tobacco, Rice"). Shows the FIRST
 * segment as a badge; any extras collapse into a "+N" pill that opens a small
 * popover listing every segment. Used by the Map Supplier + Mapped Suppliers
 * cards so a multi-segment supplier doesn't overflow the row. */
export function SegmentTags({ segment, tagClassName }: { segment?: string; tagClassName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  const segs = (segment || '').split(',').map(s => s.trim()).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!segs.length) return null;

  const [first, ...rest] = segs;
  return (
    <span className="seg-tags" ref={ref}>
      <span className={tagClassName}>{first}</span>
      {rest.length > 0 && (
        <>
          <Tooltip label="View all segments"><button type="button" className="seg-more-pill" onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>+{rest.length}</button></Tooltip>
          {open && (
            <div className="seg-more-pop">
              <div className="seg-more-pop-hdr">Segments ({segs.length})</div>
              <div className="seg-more-pop-list">
                {segs.map(s => <span key={s} className="seg-more-pop-item">{s}</span>)}
              </div>
            </div>
          )}
        </>
      )}
    </span>
  );
}
