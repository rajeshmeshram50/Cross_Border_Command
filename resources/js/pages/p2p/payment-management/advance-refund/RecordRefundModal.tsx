// Log refunds received against an Advance Receipt Refund Adjustment until nothing
// is outstanding. Reuses the Order module's Add New Payment popup (apay-*).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useEscapeClose } from './useEscapeClose';
import { Ref } from '../../purchase-management/order/AddPaymentModal';
import { ICON_X, money, fmtDate } from '../../purchase-management/order/payment-shared';
import { IcoRefund, IcoWarn } from '../../purchase-management/order/icons';
import { findPo, refundFigures, todayIso, type RefundAdjustment, type RefundRecovery } from './refund-data';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/add-payment.css';
import './advance-refund.css';

type Props = {
  refund: RefundAdjustment;
  onSave: (entry: RefundRecovery) => void;
  onClose: () => void;
};

export default function RecordRefundModal({ refund, onSave, onClose }: Props) {
  useScrollLock();

  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => { amountRef.current?.focus(); }, []);
  useEscapeClose(onClose);

  const fig = refundFigures(refund);
  const done = fig.pending === 0;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState('');

  const save = () => {
    const amt = Math.round(parseFloat(amount) || 0);
    if (amt <= 0) { setError('Enter the recovered amount.'); return; }
    if (amt > fig.pending) { setError(`Only ${money(fig.pending)} is still outstanding on this refund.`); return; }
    if (!date) { setError('Pick the refunded date.'); return; }
    if (date < refund.date) { setError(`The refunded date cannot be before the refund was raised (${fmtDate(refund.date)}).`); return; }
    if (date > todayIso()) { setError('The refunded date cannot be in the future.'); return; }
    onSave({ amount: amt, date });
  };

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="apay-card" role="dialog" aria-modal="true" aria-labelledby="arf-rec-title" tabIndex={-1}>

        <div className="apay-hd">
          <span className="apay-hd__ico"><IcoRefund size={18} /></span>
          <div className="apay-hd__txt">
            <div className="apay-hd__t" id="arf-rec-title">Payment Recovery</div>
            <div className="apay-hd__refs">
              <Ref label="Refund No." value={refund.no} mono />
              <Ref label="Supplier" value={findPo(refund.po)?.supplier ?? '—'} />
              <Ref label="PO Number" value={refund.po} mono />
            </div>
          </div>
          <button type="button" className="apay-hd__x" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="apay-bd">
          <div className="apay-banner">
            <div className="apay-banner__ico"><IcoRefund size={20} /></div>
            <div className="apay-banner__main">
              <div className="apay-banner__lbl">Outstanding Refund</div>
              <div className="apay-banner__val">{money(fig.pending)}</div>
            </div>
            <div className="apay-banner__chips">
              <span className="apay-chip">To Be Refunded <b>{money(fig.toRefund)}</b></span>
              <span className="apay-chip">Recovered <b>{money(fig.recovered)}</b></span>
            </div>
          </div>

          {!done && (
            <div className="apay-grid">
              <div className="apay-f">
                <label htmlFor="arf-rec-amt">Recovered Amount</label>
                <div className="apay-inwrap">
                  <span className="apay-prefix">₹</span>
                  <input id="arf-rec-amt" ref={amountRef} className="apay-in" inputMode="decimal" placeholder="0.00"
                    value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} />
                </div>
              </div>
              <div className="apay-f">
                <label htmlFor="arf-rec-date">Refunded Date</label>
                <input id="arf-rec-date" className="apay-in" type="date" min={refund.date} max={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} />
              </div>
            </div>
          )}

          <div className="arf-hist">
            {refund.recoveries.length === 0 ? (
              <div className="arf-hist__empty">Nothing recovered yet — record the first refund above.</div>
            ) : (
              <table className="spi-table">
                <thead><tr><th>Sr. No</th><th>Recovered Amount</th><th>Refunded Date</th></tr></thead>
                <tbody>
                  {refund.recoveries.map((r, i) => (
                    <tr key={`${r.date}-${i}`}><td>{i + 1}</td><td>{money(r.amount)}</td><td>{fmtDate(r.date)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {error && <div className="apay-err"><IcoWarn /><span>{error}</span></div>}
        </div>

        <div className="apay-ft">
          <button type="button" className="spi-mdl-cancel" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {!done && <button type="button" className="spi-mdl-confirm" onClick={save}>Save Recovery</button>}
        </div>

      </div>
    </div>,
    document.body,
  );
}
