import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import api from '../../../../api';

/* ─────────────────────────────────────────────────────────────────────────
 * "Map Supplier Purchase Invoice" choice modal.
 *
 * The user picks how to map a new supplier invoice:
 *   • With Purchase Order    → link to an existing PO (3-way match)
 *   • Without Purchase Order → standalone invoice against a supplier
 *
 * Both dropdowns load live data from the SPI dropdown endpoints — lazily (only
 * the list the chosen path needs) and with request cancellation. On confirm we
 * hand the chosen mode + selection up so the detail wizard opens with real context.
 * ───────────────────────────────────────────────────────────────────────── */

type Choice = 'with' | 'without' | null;
type LoadState = 'idle' | 'loading' | 'error' | 'ready';

type PoOption = { id: number; code: string; supplier: string; has_shipment: boolean };
type SupplierOption = { id: number; name: string; code: string };

/* Axios aborts a request (via AbortController) with a CanceledError — those are
   expected on unmount/reload and must not surface to the user as a load error. */
const isCanceled = (e: unknown): boolean =>
  !!e && typeof e === 'object'
  && ((e as { code?: string }).code === 'ERR_CANCELED' || (e as { name?: string }).name === 'CanceledError');

export type MapConfirmPayload =
  | { mode: 'with'; poId: number; poCode: string; supplierName: string }
  | { mode: 'without'; supplierId: number; supplierName: string };

export default function MapSupplierPurchaseInvoiceModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (payload: MapConfirmPayload) => void;
}) {
  useScrollLock();
  const [choice, setChoice] = useState<Choice>(null);
  const [poId, setPoId] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const [pos, setPos] = useState<PoOption[]>([]);
  const [poState, setPoState] = useState<LoadState>('idle');
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supState, setSupState] = useState<LoadState>('idle');

  // Live AbortControllers so an in-flight fetch is cancelled on unmount (and
  // when a Retry replaces the previous request for the same list).
  const poAbort = useRef<AbortController | null>(null);
  const supAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { poAbort.current?.abort(); supAbort.current?.abort(); }, []);

  /* Purchase orders available to map (SPI's own dropdown endpoint). */
  const loadPos = useCallback(async () => {
    poAbort.current?.abort();
    const ctrl = new AbortController();
    poAbort.current = ctrl;
    setPoState('loading');
    try {
      const r = await api.get('/p2p/supplier-purchase-invoices/purchase-orders', { signal: ctrl.signal });
      const rows = (r.data?.data ?? []) as Array<{ id: number; code: string; supplier: string; has_shipment?: boolean }>;
      setPos(rows.map(x => ({ id: x.id, code: x.code, supplier: x.supplier ?? '', has_shipment: !!x.has_shipment })));
      setPoState('ready');
    } catch (e) {
      if (!isCanceled(e)) setPoState('error');
    }
  }, []);

  const loadSuppliers = useCallback(async () => {
    supAbort.current?.abort();
    const ctrl = new AbortController();
    supAbort.current = ctrl;
    setSupState('loading');
    try {
      const r = await api.get('/p2p/supplier-purchase-invoices/suppliers', { signal: ctrl.signal });
      const rows = (r.data?.data ?? []) as Array<{ id: number; name: string; code?: string | null }>;
      setSuppliers(rows.map(x => ({ id: x.id, name: x.name, code: x.code ?? '' })));
      setSupState('ready');
    } catch (e) {
      if (!isCanceled(e)) setSupState('error');
    }
  }, []);

  /* Lazy-load only the list the chosen path needs, and only once. */
  useEffect(() => {
    if (choice === 'with' && poState === 'idle') void loadPos();
    if (choice === 'without' && supState === 'idle') void loadSuppliers();
  }, [choice, poState, supState, loadPos, loadSuppliers]);

  const canConfirm = (choice === 'with' && !!poId) || (choice === 'without' && !!supplierId);

  const handleConfirm = () => {
    if (choice === 'with') {
      const sel = pos.find(p => String(p.id) === poId);
      if (sel) onConfirm({ mode: 'with', poId: sel.id, poCode: sel.code, supplierName: sel.supplier });
    } else if (choice === 'without') {
      const sel = suppliers.find(s => String(s.id) === supplierId);
      if (sel) onConfirm({ mode: 'without', supplierId: sel.id, supplierName: sel.name });
    }
  };

  const poPlaceholder =
    poState === 'loading' ? 'Loading purchase orders…'
    : poState === 'error' ? 'Could not load purchase orders'
    : poState === 'ready' && pos.length === 0 ? 'No purchase orders available'
    : '— Select a Purchase Order —';

  const supPlaceholder =
    supState === 'loading' ? 'Loading suppliers…'
    : supState === 'error' ? 'Could not load suppliers'
    : supState === 'ready' && suppliers.length === 0 ? 'No suppliers available'
    : '— Select Supplier —';

  return createPortal(
    <div className="spi-mdl-backdrop" onMouseDown={onClose}>
      <div className="spi-mdl" onMouseDown={e => e.stopPropagation()}>
        {/* Header */}
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoDoc /></div>
            <div>
              <div className="spi-mdl-title">Map Supplier Purchase Invoice</div>
              <div className="spi-mdl-sub">Choose how to map this supplier invoice.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="spi-mdl-body">
          <div className="spi-mdl-seclabel">MAP INVOICE TO PROCUREMENT</div>

          {/* With Purchase Order */}
          <button type="button" className={`spi-mdl-card ${choice === 'with' ? 'is-sel is-teal' : ''}`} onClick={() => setChoice('with')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-teal"><IcoLink /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">With Purchase Order <span className="spi-mdl-badge spi-mdl-badge-teal">RECOMMENDED</span></div>
              <div className="spi-mdl-card-desc">Link this invoice to an existing PO for a 3-way match.</div>
            </div>
            <span className={`spi-mdl-radio ${choice === 'with' ? 'is-on-teal' : ''}`}>{choice === 'with' && <IcoCheck />}</span>
          </button>

          {choice === 'with' && (
            <div className="spi-mdl-field">
              <label className="spi-mdl-fieldlabel"><IcoLink size={13} /> SELECT PURCHASE ORDER <span className="spi-mdl-req">*</span></label>
              <ModalSelect
                value={poId}
                placeholder={poPlaceholder}
                disabled={poState === 'loading'}
                options={pos.map(p => ({ value: String(p.id), label: `${p.code}${p.supplier ? ` — ${p.supplier}` : ''}`, badge: p.has_shipment ? 'with' : 'without' }))}
                onChange={setPoId}
              />
              {poState === 'error' && (
                <button type="button" className="spi-mdl-retry" onClick={() => void loadPos()}>Retry</button>
              )}
            </div>
          )}

          {/* Without Purchase Order */}
          <button type="button" className={`spi-mdl-card ${choice === 'without' ? 'is-sel is-amber' : ''}`} onClick={() => setChoice('without')}>
            <div className="spi-mdl-card-ico spi-mdl-ico-amber"><IcoWarn /></div>
            <div className="spi-mdl-card-mid">
              <div className="spi-mdl-card-title">Without Purchase Order <span className="spi-mdl-badge spi-mdl-badge-amber">STANDALONE</span></div>
              <div className="spi-mdl-card-desc">Capture a supplier invoice not tied to any PO.</div>
            </div>
            <span className={`spi-mdl-radio ${choice === 'without' ? 'is-on-amber' : ''}`}>{choice === 'without' && <IcoCheck />}</span>
          </button>

          {choice === 'without' && (
            <>
              <div className="spi-mdl-warn">
                <IcoWarn size={14} />
                <span><b>Standalone invoice</b> — not linked to any purchase order. Select the supplier this invoice is for.</span>
              </div>
              <div className="spi-mdl-field">
                <label className="spi-mdl-fieldlabel"><IcoLink size={13} /> SELECT SUPPLIER <span className="spi-mdl-req">*</span></label>
                <ModalSelect
                  value={supplierId}
                  placeholder={supPlaceholder}
                  disabled={supState === 'loading'}
                  options={suppliers.slice().sort((a, b) => (parseInt(String(b.code).replace(/\D/g, ''), 10) || 0) - (parseInt(String(a.code).replace(/\D/g, ''), 10) || 0)).map(s => ({ value: String(s.id), label: s.code ? `${s.code} — ${s.name}` : s.name }))}
                  onChange={setSupplierId}
                />
                {supState === 'error' && (
                  <button type="button" className="spi-mdl-retry" onClick={() => void loadSuppliers()}>Retry</button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="spi-mdl-foot">
          <div className="spi-mdl-audit"><IcoClock /> All invoices are audit-tracked</div>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" disabled={!canConfirm} onClick={handleConfirm}>
              Confirm &amp; Continue <IcoArrow />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Custom dropdown (matches the PO wizard's Dd — styled panel, not a native
      <select>, so the open list looks consistent across browsers). ── */
type DdOption = { value: string; label: string; badge?: 'with' | 'without' };

function ModalSelect({ value, options, onChange, placeholder, disabled }: {
  value: string;
  options: DdOption[];
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  // Position the portalled panel under the button, flipping up if it would
  // overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = Math.min(264, Math.max(options.length, 1) * 40 + 10);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.spi-mdl-dd-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // A scroll INSIDE the dropdown's own option list must not close it — else
    // the list snaps shut the moment you wheel-scroll it (no smooth scrolling).
    // Only scrolls in an ancestor (the modal / page) should dismiss the menu.
    const close = (e?: Event) => {
      const el = e && e.target instanceof Element ? e.target : null;
      if (el && el.closest('.spi-mdl-dd-pop')) return;
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

  const selected = options.find(o => o.value === value);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        disabled={disabled}
        className={`spi-mdl-dd ${open ? 'is-open' : ''}`}
        onClick={() => !disabled && setOpen(o => !o)}
      >
        <span className={`spi-mdl-dd-val ${selected ? '' : 'is-placeholder'}`}>{selected ? selected.label : placeholder}</span>
        <IcoChevDd />
      </button>
      {open && !disabled && createPortal(
        <div className="spi-mdl-dd-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.length === 0
            ? <div className="spi-mdl-dd-empty">No options available</div>
            : options.map(o => (
              <div
                key={o.value}
                className={`spi-mdl-dd-opt ${o.value === value ? 'is-sel' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                <span className="spi-mdl-dd-opt-lbl">{o.label}</span>
                {o.badge && <span className={`spi-mdl-shipbadge ${o.badge === 'with' ? 'is-with' : 'is-without'}`}>{o.badge === 'with' ? 'With Shipment' : 'Without Shipment'}</span>}
                <span className="spi-mdl-dd-opt-ck"><IcoCheckSm /></span>
              </div>
            ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/* ── Inline icons ── */
function IcoChevDd() { return <svg className="spi-mdl-dd-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoCheckSm() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoDoc() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoLink({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>; }
function IcoWarn({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>; }
function IcoCheck() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoClock() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>; }
function IcoArrow() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
