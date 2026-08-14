import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Tooltip from './ui/Tooltip';

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

/* ── File identity helpers ────────────────────────────────────────────────────
   A receipt uploaded straight off a phone is often named "13418200434190.jpg"
   or "320-Screenshot 2026-06-04.png". Cutting that to a bare 14 characters
   dropped the extension and left a numeric blob that didn't read as a file at
   all. These helpers keep the extension (the strongest "this is a document"
   signal), pick a matching glyph, and put the untouched name in the tooltip. */

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg'];

/** Extension from the file name, falling back to the URL path. Lower-cased,
 *  no dot; '' when there isn't one. */
function extOf(name?: string, url?: string): string {
  const fromName = (name ?? '').split('?')[0];
  const pick = (s: string) => {
    const base = s.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : '';
  };
  return pick(fromName) || pick((url ?? '').split('?')[0]);
}

/** Remixicon glyph + a human label for the type, so the chip reads as a
 *  document rather than a coloured tag. */
function fileMeta(ext: string): { icon: string; label: string } {
  if (ext === 'pdf') return { icon: 'ri-file-pdf-2-line', label: 'PDF' };
  if (IMAGE_EXTS.includes(ext)) return { icon: 'ri-image-2-line', label: 'Image' };
  if (ext === 'doc' || ext === 'docx') return { icon: 'ri-file-word-2-line', label: 'Word doc' };
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return { icon: 'ri-file-excel-2-line', label: 'Spreadsheet' };
  return { icon: 'ri-file-text-line', label: 'File' };
}

/** Shorten the STEM only and keep the extension attached — "320-Screenshot
 *  2026-06-04.png" becomes "320-Screensh….png", never "320-Screensho". */
function shortName(name: string, max = 20): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0 && dot < name.length - 1 && name.length - dot <= 6;
  const ext = hasExt ? name.slice(dot) : '';
  const stem = hasExt ? name.slice(0, dot) : name;
  const keep = Math.max(4, max - ext.length - 1);
  return stem.length <= keep ? `${stem}${ext}` : `${stem.slice(0, keep)}…${ext}`;
}

function fmtSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tooltip text: what the file is and what a click does (size is not shown). */
function hint(name: string, _size: number | undefined, typeLabel: string): string {
  return `${name} · ${typeLabel} — opens in a new tab`;
}

/* Hover affordance: the chip lifts and underlines, so it reads as a link
   rather than a status badge. Injected once, scoped to the chip class. */
const PROOF_CSS = `
  .proof-chip { cursor: pointer; transition: filter .14s ease, box-shadow .14s ease; }
  .proof-chip:hover { filter: brightness(0.97); box-shadow: 0 2px 6px rgba(15,23,42,0.12); }
  .proof-chip:hover .proof-chip-name { text-decoration: underline; }
  .proof-chip:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
  .pop-proof-item { transition: background 120ms ease; }
  .pop-proof-item:hover { background: rgba(128,128,128,0.14); }
  .pop-proof-item:hover .proof-chip-name { text-decoration: underline; }
`;

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
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const left = Math.min(Math.max(8, b.left), window.innerWidth - POP_W - 8);
    const below = b.bottom + 6;
    if (below + POP_MAXH > window.innerHeight - 8) {
      // Not enough room below → flip ABOVE the trigger. Anchor by the BOTTOM
      // edge (not top-minus-POP_MAXH): a short list is much smaller than the max
      // height, so anchoring by top left the popover floating ~100px above the
      // button with a visible gap — reading as "detached" (QA #137/140/141).
      setPos({ bottom: Math.max(8, window.innerHeight - b.top + 6), left });
    } else {
      setPos({ top: below, left });
    }
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
    background: accent.bg, color: accent.fg, fontWeight: 500,
    border: `1px solid ${accent.border}`,
  };

  const firstName = first.name || 'Receipt 1';
  const firstExt = extOf(first.name, first.url);
  const firstMeta = fileMeta(firstExt);

  return (
    <div className="d-inline-flex align-items-center" style={{ gap: 4, maxWidth: '100%', minWidth: 0 }}>
      <style>{PROOF_CSS}</style>
      <Tooltip label={hint(firstName, first.size, firstMeta.label)}>
        <a
          href={withAuthToken(first.url!)}
          target="_blank"
          rel="noreferrer"
          className="proof-chip d-inline-flex align-items-center gap-1 text-decoration-none"
          style={{ ...chipStyle, maxWidth: '100%', minWidth: 0, whiteSpace: 'nowrap' }}
        >
          <i className={firstMeta.icon} style={{ flexShrink: 0, fontSize: 13 }} />
          <span className="proof-chip-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {shortName(firstName)}
          </span>
          {/* Explicit "this opens something" cue — the icon alone reads as
              decoration on a coloured badge. */}
          <i className="ri-external-link-line" style={{ flexShrink: 0, fontSize: 11, opacity: 0.75 }} />
        </a>
      </Tooltip>

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
                position: 'fixed',
                ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
                left: pos.left, zIndex: 3000,
                width: POP_W, maxHeight: POP_MAXH, overflowY: 'auto',
                background: 'var(--vz-secondary-bg, #ffffff)',
                border: '1px solid rgba(128,128,128,0.30)',
                borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,0.22)', padding: 6,
              }}
            >
              {rest.map((att, i) => {
                const nm = att.name || `Receipt ${i + 2}`;
                const m = fileMeta(extOf(att.name, att.url));
                return (
                  <a
                    key={`${att.url}-${i}`}
                    href={withAuthToken(att.url!)}
                    target="_blank"
                    rel="noreferrer"
                    className="d-flex align-items-center gap-2 text-decoration-none pop-proof-item"
                    title={hint(nm, att.size, m.label)}
                    style={{ padding: '7px 9px', borderRadius: 8, color: accent.fg, fontSize: 12, fontWeight: 500 }}
                  >
                    <i className={m.icon} style={{ flexShrink: 0, fontSize: 14 }} />
                    <span className="d-flex flex-column" style={{ minWidth: 0, lineHeight: 1.2 }}>
                      <span className="proof-chip-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {nm}
                      </span>
                      {/* File type only — size is not shown. */}
                      <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>{m.label}</span>
                    </span>
                    <i className="ri-external-link-line ms-auto" style={{ flexShrink: 0, fontSize: 12, opacity: 0.7 }} />
                  </a>
                );
              })}
            </div>,
            document.body,
          )}
        </>
      )}
    </div>
  );
}
