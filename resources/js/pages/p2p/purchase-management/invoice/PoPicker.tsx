import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDmy } from '../../../../utils/formatDmy';
import { PO_TYPE_LABEL } from '../order/gst-approval/approval-format';
import type { PoListRow } from '../order/api/po-api';

/**
 * The Purchase Order picker for the SPI chooser.
 *
 * Not a MasterSelect: that renders one line of text plus a badge, and an order
 * is picked on five facts at once — which order, whose, when, what it is tied
 * to, and for how much. Those do not fit on a line, and squeezing them onto
 * one is what made the old list unreadable at a glance.
 *
 * The panel is portalled and positioned against the trigger, because the
 * dialog it lives in clips its own overflow.
 */

const IcoSearch = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const IcoChev = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IcoTick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const DOC_LABEL: Record<string, string> = { domestic: 'Domestic', international: 'International' };

/** The order's own currency, in Indian digit grouping. */
const amountOf = (r: PoListRow) => {
  const n = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(r.grand_total ?? 0);
  return r.currency_code && r.currency_code !== 'INR' ? `${r.currency_code} ${n}` : `₹${n}`;
};

/** Everything the order is tied to, in the order a person reads it. */
const refsOf = (r: PoListRow) => [
  r.shipment_code || 'No shipment',
  r.opportunity_code,
  r.procurement_request_code,
  r.po_type ? PO_TYPE_LABEL[r.po_type] : null,
  r.document_type ? DOC_LABEL[r.document_type] : null,
].filter(Boolean).join(' · ');

/** Supplier, their code, and the date the order was raised. */
const titleOf = (r: PoListRow) =>
  [r.supplier_name || '—', r.supplier_code, r.po_date ? formatDmy(r.po_date) : null]
    .filter(Boolean).join(' · ');

/**
 * Where the order's procurement case came from.
 *
 * `link_procurement` is the order's own record of the choice made when it was
 * raised: 'yes' against a case that already existed, 'no' against one it did
 * not link. A standalone order has neither — the server forbids the field
 * there — so it gets no pill rather than a misleading one.
 *
 * Note that until Create PO offers that choice this reads 'no' on every
 * shipment order, because po-draft sends it as a constant.
 */
const procOf = (r: PoListRow): { label: string; tone: string } | null => {
  if (r.link_procurement === 'yes') return { label: 'Existing', tone: 'live' };
  if (r.link_procurement === 'no') return { label: 'Auto-created', tone: 'warn' };
  /* Null is only ever a standalone order — the server requires the field on a
     shipment order and forbids it on a standalone one. The design shows
     nothing here, so neither do we; the grid keeps the column open so the
     amounts beside it stay in line. */
  return null;
};

function Row({ r, on, onPick }: { r: PoListRow; on: boolean; onPick: () => void }) {
  const proc = procOf(r);
  return (
    <div
      className={`spim${on ? ' sel' : ''}`}
      role="option" aria-selected={on} tabIndex={0}
      onClick={onPick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
    >
      <span className="spim-code">{r.code}</span>
      <div className="spim-main">
        <div className="spim-name">{titleOf(r)}</div>
        <div className="spim-sub">{refsOf(r)}</div>
      </div>
      <span className="spim-amt">{amountOf(r)}</span>
      {proc ? <span className={`spim-st spim-st--${proc.tone}`}>{proc.label}</span> : <span />}
      <span className="spim-tick"><IcoTick /></span>
    </div>
  );
}

export default function PoPicker({
  rows, value, onChange, search, onSearch, onScrollEnd, loading, loadingMore,
}: {
  rows: PoListRow[];
  /** The picked order's id as a string, or '' for none. */
  value: string;
  onChange: (row: PoListRow) => void;
  search: string;
  onSearch: (q: string) => void;
  onScrollEnd: () => void;
  loading?: boolean;
  loadingMore?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const picked = rows.find(r => String(r.id) === value) ?? null;

  /* Measured against the trigger, and flipped above it when there is more room
     there — the dialog sits low on short screens. */
  const place = useCallback(() => {
    const t = trigRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const cap = Math.min(360, window.innerHeight - 24);
    setPos(below >= 260 || below >= above
      ? { left: r.left, width: r.width, top: r.bottom + 6, maxHeight: Math.max(180, Math.min(cap, below)) }
      : { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.max(180, Math.min(cap, above)) });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || trigRef.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('resize', place);
    /* Capture: the list scrolls inside the panel, and the dialog behind it
       scrolls too — only the latter should move the panel. */
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <div className={`spidd${open ? ' is-open' : ''}`}>
      <button
        type="button" ref={trigRef} className="spidd-trig"
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {picked ? (
          <span className="spisel">
            <span className="spim-code">{picked.code}</span>
            <span className="spisel-main">
              <span className="spisel-n">{titleOf(picked)}</span>
              <span className="spisel-s">{refsOf(picked)}</span>
            </span>
            <span className="spim-amt">{amountOf(picked)}</span>
          </span>
        ) : (
          <span className="spidd-ph">Select a Purchase Order…</span>
        )}
        <span className="spidd-chev"><IcoChev /></span>
      </button>

      {open && pos && createPortal(
        <div
          className="spidd-panel" ref={panelRef} role="listbox"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          <div className="spidd-search">
            <IcoSearch />
            <input
              type="text" autoFocus autoComplete="off"
              placeholder="Search PO, supplier, shipment, procurement…"
              value={search}
              onChange={e => onSearch(e.target.value)}
            />
          </div>
          <div
            className="spidd-list"
            onScroll={e => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) onScrollEnd();
            }}
          >
            {rows.length === 0 ? (
              <div className="spidd-empty">
                {loading ? 'Loading purchase orders…'
                  : search ? `No purchase order matches “${search}”`
                  : 'No submitted purchase order is ready to invoice'}
              </div>
            ) : (
              <>
                {rows.map(r => (
                  <Row
                    key={r.id} r={r} on={String(r.id) === value}
                    onPick={() => { onChange(r); setOpen(false); }}
                  />
                ))}
                {loadingMore && <div className="spidd-empty">Loading more…</div>}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
