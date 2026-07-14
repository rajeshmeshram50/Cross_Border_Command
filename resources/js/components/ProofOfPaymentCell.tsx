import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Proof-of-Payment table cell.
 *
 * Shows only the FIRST attachment as a chip; any additional receipts collapse
 * into a "+N more" pill. Clicking the pill opens a fixed-position, scrollable
 * popover (rendered through a portal so it floats above the table) listing the
 * remaining attachments — the row height/width never change no matter how many
 * files were uploaded. Used by both ExpenseClaimsTable and AdvanceRequestsTable
 * (HR Expense Management + the employee-profile Expense tab).
 */

export interface ProofAttachment {
  name?: string;
  size?: number;
  url?: string;
}

interface Accent {
  bg: string;
  fg: string;
  border: string;
}

const POP_W = 244;
const POP_MAXH = 220;

export default function ProofOfPaymentCell({
  attachments,
  withAuthToken,
  accent,
}: {
  attachments: ProofAttachment[] | undefined;
  withAuthToken: (url: string) => string;
  accent: Accent;
}) {
  const list = (attachments ?? []).filter(a => a?.url);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const left = Math.min(Math.max(8, b.left), window.innerWidth - POP_W - 8);
    // Flip above the trigger when it would overflow the viewport bottom.
    let top = b.bottom + 6;
    if (top + POP_MAXH > window.innerHeight - 8) top = Math.max(8, b.top - 6 - POP_MAXH);
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onReflow = () => place();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onReflow, true);
    window.addEventListener('scroll', onReflow, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onReflow, true);
      window.removeEventListener('scroll', onReflow, true);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (list.length === 0) {
    return <span className="text-muted" style={{ fontSize: 11 }}>—</span>;
  }

  const first = list[0];
  const rest = list.slice(1);

  const chipStyle: React.CSSProperties = {
    fontSize: 11, padding: '3px 9px', borderRadius: 8,
    background: accent.bg, color: accent.fg, fontWeight: 600,
    border: `1px solid ${accent.border}`,
  };

  return (
    <div className="d-inline-flex align-items-center" style={{ gap: 4 }}>
      <a
        href={withAuthToken(first.url!)}
        target="_blank"
        rel="noreferrer"
        className="d-inline-flex align-items-center gap-1 text-decoration-none"
        title={first.name || 'Attachment 1'}
        style={{ ...chipStyle, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        <i className="ri-file-text-line" />
        {(first.name || 'Receipt 1').slice(0, 14)}
      </a>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            ref={btnRef}
            onClick={() => setOpen(o => !o)}
            className="d-inline-flex align-items-center"
            title={`${rest.length} more attachment${rest.length === 1 ? '' : 's'}`}
            style={{ ...chipStyle, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            +{rest.length} more
          </button>

          {open && pos && createPortal(
            <div
              ref={popRef}
              className="pop-proof"
              style={{
                position: 'fixed', top: pos.top, left: pos.left, zIndex: 3000,
                width: POP_W, maxHeight: POP_MAXH, overflowY: 'auto',
                background: 'var(--vz-secondary-bg, #ffffff)',
                border: '1px solid rgba(128,128,128,0.30)',
                borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.22)', padding: 6,
              }}
            >
              <style>{`
                .pop-proof-item { transition: background 120ms ease; }
                .pop-proof-item:hover { background: rgba(128,128,128,0.14); }
              `}</style>
              {rest.map((att, i) => (
                <a
                  key={`${att.url}-${i}`}
                  href={withAuthToken(att.url!)}
                  target="_blank"
                  rel="noreferrer"
                  className="d-flex align-items-center gap-2 text-decoration-none pop-proof-item"
                  title={att.name || `Attachment ${i + 2}`}
                  style={{ padding: '7px 9px', borderRadius: 8, color: accent.fg, fontSize: 12, fontWeight: 600 }}
                >
                  <i className="ri-file-text-line" style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {att.name || `Receipt ${i + 2}`}
                  </span>
                </a>
              ))}
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
