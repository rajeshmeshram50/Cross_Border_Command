import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import type { ReleasePayment } from './MakePoPaymentModal';
import { Chip, ICON_X, ccySymbol, moneyIn } from './payment-shared';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';
import './add-payment.css';

export type AddPaymentProps = {
  requestId: string;
  supplier: string;
  poNumber: string;
  spiNumber?: string;
  spiCount: number;
  approved: number;
  paid: number;
  initial?: ReleasePayment;
  onSave: (p: ReleasePayment) => void | Promise<void>;
  onClose: () => void;
  /** The PO's own currency. */
  ccy?: string | null;
};

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_CARD = (
  <svg {...ic}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
);

const ICON_WALLET = (
  <svg {...ic} strokeWidth={2}>
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
);

const ICON_UPLOAD = (
  <svg {...ic}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const ICON_ALERT = (
  <svg {...ic} strokeWidth={2.4}>
    <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

function amountValue(v: string): number {
  const n = parseFloat(String(v).replace(/[,\s₹]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

// Label/value pair for popup headers (used by the Advance Refund popups).
export function Ref({ label, value, mono, extra }: { label: string; value: string; mono?: boolean; extra?: string }) {
  return (
    <div className={`apay-ref${mono ? ' apay-ref--mono' : ''}`}>
      <span className="apay-ref__k">{label}{extra}</span>
      <span className="apay-ref__v">{value}</span>
    </div>
  );
}

const blankIfDash = (v?: string) => (!v || v === '—' ? '' : v);

/** The inputs an error can land on. */
type FieldKey = 'amount' | 'bank' | 'utr' | 'date' | 'proof';

/** Server field keys -> the inputs on this form. */
const FIELD_OF: Record<string, FieldKey> = {
  amount: 'amount', bank_name: 'bank', utr_cheque_number: 'utr', utr_cheque_date: 'date', proof: 'proof',
};

export default function AddPaymentModal({
  requestId, supplier, poNumber, spiNumber, spiCount, approved, paid, initial, onSave, onClose, ccy,
}: AddPaymentProps) {
  useScrollLock(true, '.apay-card');
  // Amounts here follow the PO's own currency.
  const money = moneyIn(ccy);
  const sym = ccySymbol(ccy);

  const cardRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => { (amountRef.current ?? cardRef.current)?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !savingRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const editing = !!initial;
  const room = Math.max(0, approved - paid + (initial?.amount ?? 0));

  const [amount, setAmount] = useState(
    initial ? (Number(initial.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
  );
  const [date, setDate] = useState(blankIfDash(initial?.date) || new Date().toISOString().slice(0, 10));
  const [bank, setBank] = useState(blankIfDash(initial?.bank));
  const [utr, setUtr] = useState(blankIfDash(initial?.utr));
  const [file, setFile] = useState('');
  const [upload, setUpload] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  // Read by the Escape handler, which is bound once and would otherwise see a stale value.
  const savingRef = useRef(false);
  savingRef.current = saving;
  const [error, setError] = useState('');
  /* Which field a message belongs to, so the form can point at it. A single
     banner ("Already used on another payment.") left the user hunting for the
     field that was refused (CS-425). */
  const [fieldErr, setFieldErr] = useState<Partial<Record<FieldKey, string>>>({});
  /** Put the message on a field AND in the banner, so both read the same. */
  const fail = (field: FieldKey, message: string) => { setFieldErr({ [field]: message }); setError(message); };
  const clearErrors = () => { setFieldErr({}); setError(''); };
  const invalid = (f: FieldKey) => (fieldErr[f] ? ' is-invalid' : '');
  const FieldError = ({ f }: { f: FieldKey }) => (fieldErr[f] ? <span className="apay-fielderr">{fieldErr[f]}</span> : null);

  const shownFile = file || initial?.file || '';

  const save = async () => {
    if (saving) return;
    clearErrors();
    const amt = amountValue(amount);
    if (!(amt > 0)) { fail('amount', 'Enter the amount being paid.'); return; }
    if (amt < 1) { fail('amount', `The payment amount must be at least ${sym}1.`); return; }
    if (amt > room + 0.5) {
      fail('amount', `Only ${money(room)} is still approved and unreleased on this request.`);
      return;
    }
    const ref = utr.trim();
    if (ref && !/^[A-Za-z0-9]{6,22}$/.test(ref)) { fail('utr', 'UTR / cheque number must be 6–22 letters or digits.'); return; }
    if (date && date > new Date().toISOString().slice(0, 10)) { fail('date', 'UTR / cheque date cannot be in the future.'); return; }
    if (upload && upload.size > 10 * 1024 * 1024) { fail('proof', 'Proof of payment must be 10 MB or smaller.'); return; }
    setSaving(true);
    try {
      await onSave({
        amount: Math.round(amt * 100) / 100,
        bank: bank.trim(),
        utr: ref,
        date: date.trim(),
        file: shownFile || undefined,
        upload,
      });
    } catch (e) {
      /* The server answers with the field it refused and why; show it on that
         field instead of as one more line of prose. */
      const errs = (e as { fieldErrors?: Record<string, string[]> })?.fieldErrors ?? {};
      const marks: Partial<Record<FieldKey, string>> = {};
      for (const [key, list] of Object.entries(errs)) {
        const f = FIELD_OF[key];
        if (f && list?.[0]) marks[f] = list[0];
      }
      const message = (e as { message?: string })?.message || Object.values(marks)[0] || 'The payment could not be saved.';
      setFieldErr(marks);
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className={`apay-card${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="apay-title" tabIndex={-1} ref={cardRef} aria-busy={saving}>
        {saving && (
          <div className="apay-wait" role="status" aria-live="polite">
            <span className="apay-wait__ring" />
            <span className="apay-wait__t">{editing ? 'Updating payment…' : 'Recording payment…'}</span>
            <span className="apay-wait__s">Please wait, the proof is being uploaded</span>
          </div>
        )}

        <div className="apay-hd">
          <span className="apay-hd__ico">{ICON_CARD}</span>
          <div className="apay-hd__t" id="apay-title">{editing ? 'Edit Payment' : 'Add New Payment'}</div>
          <div className="mpr-hero__chips">
            <Chip label="Request ID" value={requestId} mod="apay-chip--mono" />
            {supplier && <Chip label="Supplier" value={supplier} />}
            <Chip label="PO Number" value={poNumber} mod="apay-chip--mono" />
            {spiNumber && (
              <Chip
                label={spiCount > 1 ? 'SPI Numbers' : 'SPI Number'}
                value={spiNumber}
                mod="apay-chip--mono"
                extra={spiCount > 1 ? <span className="mpr-hero__chip-meta">+{spiCount - 1}</span> : undefined}
              />
            )}
          </div>
          <button type="button" className="apay-hd__x" onClick={onClose} disabled={saving} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="apay-bd">
          <div className="apay-banner">
            <div className="apay-banner__ico">{ICON_WALLET}</div>
            <div className="apay-banner__main">
              <div className="apay-banner__lbl">Approved And Unreleased</div>
              <div className="apay-banner__val">{money(room)}</div>
            </div>
            <div className="apay-banner__chips">
              <span className="apay-chip">Approved <b>{money(approved)}</b></span>
              <span className="apay-chip">Already Paid <b>{money(paid)}</b></span>
            </div>
          </div>

          <div className="apay-grid">
            <div className="apay-f">
              <label htmlFor="apay-amount">Amount To Be Pay</label>
              <div className="apay-inwrap">
                <span className="apay-prefix">{sym}</span>
                <input
                  id="apay-amount"
                  ref={amountRef}
                  className={`apay-in${invalid('amount')}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  disabled={saving}
                  aria-invalid={!!fieldErr.amount}
                  onChange={(e) => { setAmount(e.target.value); clearErrors(); }}
                />
              </div>
              <FieldError f="amount" />
            </div>

            <div className="apay-f">
              <label htmlFor="apay-date">UTR / Cheque Date</label>
              <input id="apay-date" className={`apay-in${invalid('date')}`} type="date" value={date} disabled={saving}
                aria-invalid={!!fieldErr.date} onChange={(e) => { setDate(e.target.value); clearErrors(); }} />
              <FieldError f="date" />
            </div>

            <div className="apay-f">
              <label htmlFor="apay-bank">Bank Name</label>
              <input id="apay-bank" className={`apay-in${invalid('bank')}`} placeholder="Enter bank name" value={bank} disabled={saving}
                aria-invalid={!!fieldErr.bank} onChange={(e) => { setBank(e.target.value); clearErrors(); }} />
              <FieldError f="bank" />
            </div>

            <div className="apay-f">
              <label htmlFor="apay-utr">UTR / Cheque Number</label>
              <input id="apay-utr" className={`apay-in${invalid('utr')}`} placeholder="Enter UTR / cheque number" value={utr} disabled={saving}
                aria-invalid={!!fieldErr.utr} onChange={(e) => { setUtr(e.target.value); clearErrors(); }} />
              <FieldError f="utr" />
            </div>

            <div className="apay-f apay-f--full">
              <label htmlFor="apay-file">Proof of Payment</label>
              <label className={`apay-drop${invalid('proof')}`} htmlFor="apay-file">
                <div className="apay-drop__ico">{ICON_UPLOAD}</div>
                <div className="apay-drop__txt">
                  <div className="apay-drop__t">
                    {editing && shownFile ? 'Click to replace proof of payment' : 'Click to upload proof of payment'}
                  </div>
                  <div className="apay-drop__s">{shownFile || 'PDF, JPG or PNG · No file chosen'}</div>
                </div>
                <input
                  id="apay-file"
                  className="apay-file-in"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  disabled={saving}
                  onChange={(e) => { const picked = e.target.files?.[0] ?? null; setUpload(picked); setFile(picked?.name ?? ''); }}
                />
              </label>
              <FieldError f="proof" />
            </div>
          </div>

          {error && (
            <div className="apay-err">
              {ICON_ALERT}
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="apay-ft">
          <button type="button" className="spi-mdl-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="spi-mdl-confirm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Payment'}</button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
