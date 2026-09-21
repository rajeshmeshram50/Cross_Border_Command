// Create Advance Receipt Refund Adjustment — step 1: pick the purchase order the
// supplier is crediting back. Reuses the Create PO popup shell (spi-mdl-*) and
// the shared dropdown panel (spi-mdl-dd-*); advance-refund.css adds only the
// search box and the three-part option row.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { money, fmtDate } from '../../purchase-management/order/manage-payment/payment-shared';
import { IcoCheck, IcoChevron, IcoChevronR, IcoRefund, IcoSearch, IcoX } from '../../icons';
import type { OrderRow } from '../../purchase-management/order/po-list/Order';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import './advance-refund.css';

type Props = {
  /** Orders that can carry a new refund (money released, no refund yet). */
  options: OrderRow[];
  onClose: () => void;
  onContinue: (po: string) => void;
};

export default function RefundPoPickerModal({ options, onClose, onContinue }: Props) {
  useScrollLock();
  useEscapeClose(onClose);
  const [po, setPo] = useState('');
  const picked = options.find((r) => r.po === po);

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl arf-pick" role="dialog" aria-modal="true" aria-labelledby="arf-pick-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoRefund /></div>
            <div>
              <div className="spi-mdl-title" id="arf-pick-title">Create Advance Receipt Refund Adjustment</div>
              <div className="spi-mdl-sub">Pick the purchase order the supplier is crediting back</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body">
          <div className="arf-pick-lblrow">
            <span className="spi-mdl-seclabel">PURCHASE ORDER</span>
            <span className="arf-pick-count">{options.length} with money released</span>
          </div>
          <PoSelect options={options} value={po} onChange={setPo} />
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" disabled={!picked} onClick={() => picked && onContinue(picked.po)}>
              Continue to Advance Receipt Refund Adjustment <IcoChevronR />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** PO number + date, supplier, and the amount paid — one option row / the chosen value. */
function PoLine({ row, stacked }: { row: OrderRow; stacked?: boolean }) {
  return (
    <span className="arf-pick-line">
      <span className={stacked ? 'ord-idcell arf-pick-id' : 'arf-pick-id'}>
        <span className="ord-idpill">{row.po}</span>
        {stacked && <span className="ord-idcell__date">{fmtDate(row.poDate)}</span>}
      </span>
      <span className="arf-pick-sup">{row.supplier}</span>
      <span className="arf-pick-paid">{money(row.paid)} <small>paid</small></span>
    </span>
  );
}

function PoSelect({ options, value, onChange }: { options: OrderRow[]; value: string; onChange: (po: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const selected = options.find((r) => r.po === value);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((r) => `${r.po} ${r.supplier}`.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 6, width: r.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!btnRef.current?.contains(t) && !t.closest('.arf-pick-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (po: string) => { onChange(po); setOpen(false); setQ(''); };

  return (
    <>
      <button type="button" ref={btnRef} className={`spi-mdl-dd arf-pick-dd${open ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        {selected
          ? <PoLine row={selected} />
          : <span className="spi-mdl-dd-val is-placeholder">Select the purchase order…</span>}
        <span className="spi-mdl-dd-chev"><IcoChevron /></span>
      </button>
      {/* spi-mdl-dd-pop is the shared panel; arf-pick-pop marks it so the "Esc"
          and outside-click handlers can tell it apart. */}
      {open && createPortal(
        <div className="spi-mdl-dd-pop arf-pick-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          <div className="arf-pick-search">
            <IcoSearch size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PO number or supplier…" />
          </div>
          <div className="arf-pick-list">
            {list.length === 0
              ? <div className="spi-mdl-dd-empty">No purchase order matches “{q}”.</div>
              : list.map((r) => (
                <div key={r.po} role="option" aria-selected={r.po === value}
                  className={`spi-mdl-dd-opt${r.po === value ? ' is-sel' : ''}`} onClick={() => pick(r.po)}>
                  <PoLine row={r} stacked />
                  <span className="spi-mdl-dd-opt-ck"><IcoCheck /></span>
                </div>
              ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
