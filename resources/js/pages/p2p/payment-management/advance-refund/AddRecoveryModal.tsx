// Add / edit one recovered payment against a refund adjustment. Reuses the
// Order module's Add New Payment popup body (apay-*) under the Manage Payment
// Requests hero header (mpr-hero).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Chip, ICON_X, fmtDate, money, shortDate } from '../../purchase-management/order/manage-payment/payment-shared';
import type { RecoveryBody } from '../../purchase-management/order/api/po-api';
import { IcoSave, IcoWallet, IcoWarn } from '../../icons';
import { todayIso, type RefundAdjustment, type RefundRecovery } from './refund-data';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/manage-payment/manage-payment-requests.css';
import '../../purchase-management/order/manage-payment/add-payment.css';

type Props = {
  refund: RefundAdjustment;
  /** Amount still owed, not counting the entry being edited. */
  outstanding: number;
  initial?: RefundRecovery;
  /** Resolves true when saved; the popup then closes from the parent. */
  onSave: (body: RecoveryBody) => Promise<boolean>;
  onClose: () => void;
};

const MAX_FILE = 10 * 1024 * 1024;
const UPLOAD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export default function AddRecoveryModal({ refund, outstanding, initial, onSave, onClose }: Props) {
  useEscapeClose(onClose);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => { amountRef.current?.focus(); }, []);

  const room = Math.round((outstanding + (initial?.amount ?? 0)) * 100) / 100;
  const poDate = refund.poInfo?.poDate;
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [date, setDate] = useState(initial?.date || todayIso());
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [fileName, setFileName] = useState(initial?.file ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const pick = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_FILE) { setError('Proof of payment must be 10 MB or smaller.'); return; }
    if (!/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) { setError('Proof of payment must be a PDF or an image (JPG, PNG, WEBP).'); return; }
    setFile(f); setFileName(f.name); setError('');
  };

  const save = async () => {
    const amt = Math.round((parseFloat(amount.replace(/[,\s₹]/g, '')) || 0) * 100) / 100;
    if (amt <= 0) { setError('Enter the recovered amount.'); return; }
    if (amt > room + 0.001) { setError(`Only ${money(room)} is still outstanding on this refund.`); return; }
    if (!date) { setError('Pick the refunded date.'); return; }
    if (date < refund.date) { setError(`The refunded date cannot be before the refund was raised (${fmtDate(refund.date)}).`); return; }
    if (date > todayIso()) { setError('The refunded date cannot be in the future.'); return; }
    const ref = reference.trim();
    if (ref.length > 64) { setError('Reference number can be at most 64 characters.'); return; }
    setSaving(true);
    await onSave({ amount: amt, recovered_date: date, reference_no: ref || undefined, proof: file });
    setSaving(false);
  };

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="apay-card arf-addrec" role="dialog" aria-modal="true" aria-labelledby="arf-add-title" tabIndex={-1}>
        <div className="mpr-hero">
          <div className="mpr-hero__icon"><IcoWallet /></div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="arf-add-title">{initial ? 'Edit Recovered Payment' : 'Add Recovered Payment'}</span>
            </div>
            <div className="mpr-hero__sub">{money(room)} still recoverable</div>
          </div>
          <div className="mpr-hero__chips">
            <Chip label="PO Number" value={refund.po} meta={poDate ? shortDate(poDate) : undefined} />
            <Chip label="Advance Receipt Refund Adjustment" value={refund.no} meta={shortDate(refund.date)} />
          </div>
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="apay-bd">
          <div className="apay-grid">
            <div className="apay-f">
              <label htmlFor="arf-add-amt">Recovered Amount</label>
              <div className="apay-inwrap">
                <span className="apay-prefix">₹</span>
                <input id="arf-add-amt" ref={amountRef} className="apay-in" inputMode="decimal" placeholder="0.00" maxLength={16}
                  value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} />
              </div>
            </div>
            <div className="apay-f">
              <label htmlFor="arf-add-date">Refunded Date</label>
              <input id="arf-add-date" className="apay-in" type="date" min={refund.date} max={todayIso()}
                value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} />
            </div>
            <div className="apay-f apay-f--full">
              <label htmlFor="arf-add-ref">Reference No. (Cheque / UTR)</label>
              <input id="arf-add-ref" className="apay-in" placeholder="Enter cheque / UTR number" maxLength={64}
                value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="apay-f apay-f--full">
              <label htmlFor="arf-add-file">Proof of Payment</label>
              <label className="apay-drop" htmlFor="arf-add-file">
                <div className="apay-drop__ico">{UPLOAD}</div>
                <div className="apay-drop__txt">
                  <div className="apay-drop__t">{fileName ? 'Click to replace proof of payment' : 'Click to upload proof of payment'}</div>
                  <div className="apay-drop__s">{fileName || 'PDF, JPG, PNG or WEBP · up to 10 MB'}</div>
                </div>
                <input id="arf-add-file" className="apay-file-in" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                  onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              </label>
            </div>
          </div>

          {error && <div className="apay-err"><IcoWarn /><span>{error}</span></div>}
        </div>

        <div className="apay-ft">
          <button type="button" className="spi-mdl-cancel" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" className="spi-mdl-confirm" disabled={!amount.trim() || saving} onClick={() => void save()}>
            <IcoSave /> {saving ? 'Saving…' : initial ? 'Update Payment' : 'Submit Payment'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
