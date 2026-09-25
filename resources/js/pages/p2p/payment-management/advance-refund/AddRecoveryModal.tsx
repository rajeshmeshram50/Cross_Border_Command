// Add / edit one recovered payment against a refund adjustment. Reuses the
// Order module's Add New Payment popup body (apay-*) under the Manage Payment
// Requests hero header (mpr-hero).
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile } from '../../../../utils/downloadFile';
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
const CAMERA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
  </svg>
);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  /* Where the attachment panel sits. It is portalled to the body, so it is
     placed from the drop zone's box and flips above when the foot is close. */
  const [pickAt, setPickAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const openPicker = () => {
    const r = dropRef.current?.getBoundingClientRect();
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
    // A scroll anywhere would leave the panel behind, so it goes instead.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pickAt]);
  // Where View / Download point: the file just picked, else the proof already saved.
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const fileUrl = localUrl ?? initial?.fileUrl ?? null;
  const undoPick = () => { setFile(null); setFileName(initial?.file ?? ''); };

  const pick = (f: File | null, cam = false) => {
    if (!f) return;
    if (f.size > MAX_FILE) { setError('Proof of payment must be 10 MB or smaller.'); return; }
    // A camera capture arrives as a JPEG, sometimes with no name at all.
    if (!cam && !/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) { setError('Proof of payment must be a PDF or an image (JPG, PNG, WEBP).'); return; }
    setFile(f); setFileName(f.name || `photo_${Date.now()}.jpg`); setError('');
  };

  const save = async () => {
    const amt = Math.round((parseFloat(amount.replace(/[,\s₹]/g, '')) || 0) * 100) / 100;
    if (amt <= 0) { setError('Enter the recovered amount.'); return; }
    if (amt < 1) { setError('The recovered amount must be at least ₹1.'); return; }
    if (amt > room + 0.001) { setError(`Only ${money(room)} is still outstanding on this refund.`); return; }
    if (!date) { setError('Pick the refunded date.'); return; }
    if (date < refund.date) { setError(`The refunded date cannot be before the refund was raised (${fmtDate(refund.date)}).`); return; }
    if (date > todayIso()) { setError('The refunded date cannot be in the future.'); return; }
    const ref = reference.trim();
    if (ref.length > 64) { setError('Reference number can be at most 64 characters.'); return; }
    setSaving(true);
    try {
      await onSave({ amount: amt, recovered_date: date, reference_no: ref || undefined, proof: file });
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className={`apay-card arf-addrec${saving ? ' is-saving' : ''}`} role="dialog" aria-modal="true" aria-labelledby="arf-add-title" tabIndex={-1} aria-busy={saving}>
        {saving && (
          <div className="apay-wait" role="status" aria-live="polite">
            <span className="apay-wait__ring" />
            <span className="apay-wait__t">{initial ? 'Updating recovered payment…' : 'Recording recovered payment…'}</span>
            <span className="apay-wait__s">Please wait, the proof is being uploaded</span>
          </div>
        )}
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
          <button type="button" className="mpr-hero__close" onClick={onClose} disabled={saving} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="apay-bd">
          <div className="apay-grid">
            <div className="apay-f">
              <label htmlFor="arf-add-amt">Recovered Amount</label>
              <div className="apay-inwrap">
                <span className="apay-prefix">₹</span>
                <input id="arf-add-amt" ref={amountRef} className="apay-in" inputMode="decimal" placeholder="0.00" maxLength={16}
                  disabled={saving}
                  value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} />
              </div>
            </div>
            <div className="apay-f">
              <label htmlFor="arf-add-date">Refunded Date</label>
              <input id="arf-add-date" className="apay-in" type="date" min={refund.date} max={todayIso()} disabled={saving}
                value={date} onChange={(e) => { setDate(e.target.value); setError(''); }} />
            </div>
            <div className="apay-f apay-f--full">
              <label htmlFor="arf-add-ref">Reference No. (Cheque / UTR)</label>
              <input id="arf-add-ref" className="apay-in" placeholder="Enter cheque / UTR number" maxLength={64} disabled={saving}
                value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="apay-f apay-f--full">
              <label htmlFor="arf-add-file">Proof of Payment</label>
              {/* Once a file is there it shows as a row with its actions, like the product attachment. */}
              {fileName ? (
                <div className="arf-proof">
                  <span className="arf-proof__ico" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  </span>
                  <span className="arf-proof__name" title={fileName}>{fileName}</span>
                  <span className="arf-proof__acts">
                    {fileUrl && (
                      <>
                        <a className="arf-proof__btn" href={fileUrl} target="_blank" rel="noopener noreferrer" title="View this proof">View</a>
                        <button type="button" className="arf-proof__btn" onClick={() => void downloadFile(fileUrl, fileName)} title="Download this proof">Download</button>
                      </>
                    )}
                    <button type="button" className="arf-proof__btn" disabled={saving} onClick={() => fileRef.current?.click()} title="Replace this proof">Reupload</button>
                    {file && <button type="button" className="arf-proof__btn arf-proof__btn--del" disabled={saving} onClick={undoPick} title="Remove the file you just picked">Remove</button>}
                  </span>
                </div>
              ) : (
                <>
                  <button type="button" ref={dropRef} className="apay-drop" disabled={saving} onClick={openPicker}>
                    <div className="apay-drop__ico">{UPLOAD}</div>
                    <div className="apay-drop__txt">
                      <div className="apay-drop__t">Click to upload proof of payment</div>
                      <div className="apay-drop__s">PDF, JPG, PNG or WEBP · up to 10 MB</div>
                    </div>
                  </button>
                  {/* A proof is as often shot on a phone as picked off a disk.
                      Portalled, or the popup-body's own scroller clips it. */}
                  {pickAt && createPortal(
                    <div className="arf-att" role="menu" style={{ top: pickAt.top, left: pickAt.left, width: pickAt.width }}>
                      <div className="arf-att__hd">Add attachment</div>
                      <button type="button" className="arf-att__opt" role="menuitem" onClick={() => { setPickAt(null); fileRef.current?.click(); }}>
                        <span className="arf-att__ico">{UPLOAD}</span>
                        <span><b>Upload file</b><i>Choose from this device</i></span>
                      </button>
                      <button type="button" className="arf-att__opt" role="menuitem" onClick={() => { setPickAt(null); camRef.current?.click(); }}>
                        <span className="arf-att__ico arf-att__ico--cam">{CAMERA}</span>
                        <span><b>Take photo</b><i>Capture with the camera</i></span>
                      </button>
                    </div>,
                    document.body,
                  )}
                </>
              )}
              <input id="arf-add-file" ref={fileRef} className="apay-file-in" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={saving}
                onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              <input ref={camRef} className="apay-file-in" type="file" accept="image/*" capture="environment" disabled={saving}
                onChange={(e) => { pick(e.target.files?.[0] ?? null, true); e.target.value = ''; }} />
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
