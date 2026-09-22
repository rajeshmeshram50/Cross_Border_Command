// Create Advance Receipt Refund Adjustment — step 1: pick the purchase order the
// supplier is crediting back. Only POs with money released and no adjustment yet
// (server-side). Reuses the Create PO popup shell (spi-mdl-*) and the shared
// dropdown panel (spi-mdl-dd-*); advance-refund.css adds the search and option row.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { money, fmtDate } from '../../purchase-management/order/manage-payment/payment-shared';
import { refundApi, type RefundEligiblePo } from '../../purchase-management/order/api/po-api';
import { IcoCheck, IcoChevron, IcoChevronR, IcoSearch, IcoX } from '../../icons';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import './advance-refund.css';

type Props = {
  onClose: () => void;
  onContinue: (poId: number) => void;
};

export default function RefundPoPickerModal({ onClose, onContinue }: Props) {
  useScrollLock();
  useEscapeClose(onClose);
  const [picked, setPicked] = useState<RefundEligiblePo | null>(null);
  const [q, setQ] = useState('');
  const search = useDebouncedValue(q.trim(), 300);
  const [options, setOptions] = useState<RefundEligiblePo[]>([]);
  const [loading, setLoading] = useState(true);

  // A response only applies if it is still the latest search.
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    refundApi.eligiblePos(search)
      .then((list) => { if (mine === seq.current) setOptions(list); })
      .catch(() => { if (mine === seq.current) setOptions([]); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [search]);

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl arf-pick" role="dialog" aria-modal="true" aria-labelledby="arf-pick-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            {/* The prototype's mark: a document with a return arrow (credited back). */}
            <div className="spi-mdl-head-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <polyline points="12 18 9 15 12 12" />
                <path d="M9 15h5a2 2 0 0 0 2-2v-1" />
              </svg>
            </div>
            <div>
              <div className="spi-mdl-title" id="arf-pick-title">Create Advance Receipt Refund Adjustment</div>
              <div className="spi-mdl-sub">Pick the purchase order the supplier is crediting back — raising it cancels the order</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body">
          <div className="arf-pick-lblrow">
            <span className="spi-mdl-seclabel">PURCHASE ORDER</span>
            <span className="arf-pick-count">{loading ? 'Loading…' : `${options.length} with money released`}</span>
          </div>
          <PoSelect options={options} value={picked} onChange={setPicked} q={q} onQ={setQ} loading={loading} />
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" disabled={!picked} onClick={() => picked && onContinue(picked.id)}>
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
function PoLine({ row, stacked }: { row: RefundEligiblePo; stacked?: boolean }) {
  return (
    <span className="arf-pick-line">
      <span className={stacked ? 'ord-idcell arf-pick-id' : 'arf-pick-id'}>
        <span className="ord-idpill">{row.code}</span>
        {stacked && <span className="ord-idcell__date">{fmtDate(row.po_date ?? '')}</span>}
      </span>
      <span className="arf-pick-sup">{row.supplier_name ?? '—'}</span>
      <span className="arf-pick-paid">{money(row.paid_amount)} <small>paid</small></span>
    </span>
  );
}

function PoSelect({ options, value, onChange, q, onQ, loading }: {
  options: RefundEligiblePo[]; value: RefundEligiblePo | null; onChange: (po: RefundEligiblePo) => void;
  q: string; onQ: (q: string) => void; loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

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

  const pick = (po: RefundEligiblePo) => { onChange(po); setOpen(false); onQ(''); };

  return (
    <>
      <button type="button" ref={btnRef} className={`spi-mdl-dd arf-pick-dd${open ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)}>
        {value
          ? <PoLine row={value} />
          : <span className="spi-mdl-dd-val is-placeholder">Select the purchase order…</span>}
        <span className="spi-mdl-dd-chev"><IcoChevron /></span>
      </button>
      {/* spi-mdl-dd-pop is the shared panel; arf-pick-pop marks it so the "Esc"
          and outside-click handlers can tell it apart. */}
      {open && createPortal(
        <div className="spi-mdl-dd-pop arf-pick-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          <div className="arf-pick-search">
            <IcoSearch size={14} />
            <input autoFocus value={q} maxLength={100} onChange={(e) => onQ(e.target.value)} placeholder="Search PO number or supplier…" />
          </div>
          <div className="arf-pick-list">
            {loading
              ? <div className="spi-mdl-dd-empty">Loading purchase orders…</div>
              : options.length === 0
              ? <div className="spi-mdl-dd-empty">{q ? <>No purchase order matches “{q}”.</> : 'No purchase order has money released without a refund adjustment.'}</div>
              : options.map((r) => (
                <div key={r.id} role="option" aria-selected={r.id === value?.id}
                  className={`spi-mdl-dd-opt${r.id === value?.id ? ' is-sel' : ''}`} onClick={() => pick(r)}>
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
