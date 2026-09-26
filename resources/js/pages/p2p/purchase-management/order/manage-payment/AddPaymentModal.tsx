import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import type { ReleasePayment } from './MakePoPaymentModal';
import { Chip, ICON_X, ccySymbol, moneyIn } from './payment-shared';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';
import './add-payment.css';

/* The proof is as often shot on a phone as picked off a disk, and the
   figma has both. A hidden <input capture> only opens a camera on a phone,
   so this is the same live camera the inspection screen uses (CS-423). */
const CameraCaptureModal = lazy(() => import('../physical-inspection/CameraCaptureModal'));

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


const ICON_PICK_UPLOAD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const ICON_PICK_CAMERA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
  </svg>
);

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
  /* "Add attachment" menu: upload from this device, or take the photo here. */
  const [pickAt, setPickAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const dropRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const openPicker = (el?: HTMLElement | null) => {
    const from = el ?? dropRef.current;
    const r = from?.getBoundingClientRect();
    if (!r) return;
    const H = 158;
    const below = r.bottom + 6 + H <= window.innerHeight - 12;
    setPickAt({ top: below ? r.bottom + 6 : Math.max(12, r.top - H - 6), left: r.left, width: Math.min(320, Math.max(268, r.width)) });
  };
  useEffect(() => {
    if (!pickAt) return;
    const close = () => setPickAt(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.arf-att') || (t && dropRef.current?.contains(t))) return;
      close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pickAt]);
  /** One proof, whether it was picked off the disk or shot here. */
  const takeProof = (f: File | null) => {
    if (!f) return;
    setUpload(f);
    setFile(f.name || `photo_${Date.now()}.jpg`);
    clearErrors();
  };

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
      {camOpen && (
        <Suspense fallback={null}>
          <CameraCaptureModal
            title="Take a photo of the proof"
            subject={`Payment proof · ${poNumber}`}
            namePrefix="payment-proof"
            max={1}
            onAttach={(shots) => takeProof(shots[0] ?? null)}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
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
              {/* The app's own calendar, not the browser's — popupClassName lifts it above the dialog. */}
              <MasterDatePicker value={date} onChange={(v) => { setDate(v); clearErrors(); }} disabled={saving}
                invalid={!!fieldErr.date} placeholder="Select date" popupClassName="apay-cal" />
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
              <button type="button" ref={dropRef} className={`apay-drop${invalid('proof')}`} disabled={saving}
                onClick={(e) => openPicker(e.currentTarget)}>
                <div className="apay-drop__ico">{ICON_UPLOAD}</div>
                <div className="apay-drop__txt">
                  <div className="apay-drop__t">
                    {editing && shownFile ? 'Click to replace proof of payment' : 'Click to add proof of payment'}
                  </div>
                  <div className="apay-drop__s">{shownFile || 'Upload a file or take a photo · PDF, JPG or PNG'}</div>
                </div>
              </button>
              {pickAt && createPortal(
                <div className="arf-att" role="menu" style={{ top: pickAt.top, left: pickAt.left, width: pickAt.width }}>
                  <div className="arf-att__hd">Add attachment</div>
                  <button type="button" className="arf-att__opt" role="menuitem" onClick={() => { setPickAt(null); fileRef.current?.click(); }}>
                    <span className="arf-att__ico">{ICON_PICK_UPLOAD}</span>
                    <span><b>Upload file</b><i>Choose from this device</i></span>
                  </button>
                  <button type="button" className="arf-att__opt" role="menuitem" onClick={() => { setPickAt(null); setCamOpen(true); }}>
                    <span className="arf-att__ico arf-att__ico--cam">{ICON_PICK_CAMERA}</span>
                    <span><b>Take photo</b><i>Capture with the camera</i></span>
                  </button>
                </div>,
                document.body,
              )}
              <input
                id="apay-file"
                ref={fileRef}
                className="apay-file-in"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={saving}
                onChange={(e) => { takeProof(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
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
