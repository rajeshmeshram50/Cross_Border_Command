// Cancel PO — the two screens behind the list's "Cancel PO" button (prototype
// P2P Version 1). Nothing paid on the order → one plain confirm. Money already
// released → the Advance Receipt Refund Adjustment gate: the refund has to be
// raised first, and raising it is what starts the cancellation.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { moneyIn } from '../../../../../utils/currency';
import './cancel-po.css';

const IcoCancel = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
const IcoWarn = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
const IcoDoc = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="15" x2="15" y2="15" /></svg>;
const IcoX = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
const IcoPlus = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IcoWallet = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></svg>;
const IcoInfo = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>;

export type CancelPoTarget = { po: string; supplier: string; balance: number; paid: number; currency?: string | null };

type Props = {
  target: CancelPoTarget;
  busy?: boolean;
  onClose: () => void;
  /** Nothing paid — cancel the order. */
  onConfirm: () => void;
  /** Money paid — raise the Advance Receipt Refund Adjustment. */
  onCreateRefund: () => void;
};

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export default function CancelPoModal(props: Props) {
  return props.target.paid > 0 ? <RefundGate {...props} /> : <CancelConfirm {...props} />;
}

/* One question, asked plainly: the order, what is still open, and yes or no. */
function CancelConfirm({ target, busy, onClose, onConfirm }: Props) {
  const money = moneyIn(target.currency);
  useScrollLock(true, '.pocan-box');
  useEscape(onClose);
  return createPortal(
    <div className="pocan-modal is-open" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="pocan-box" role="dialog" aria-modal="true" aria-label="Cancel purchase order">
        <div className="pocan-aura" />
        <div className="pocan-ico"><span className="pocan-ico__ring" /><IcoCancel /></div>
        <div className="pocan-t">Cancel this Purchase Order?</div>
        {/* The order as chips: the number reads as an id, the supplier as a name, the balance as money. */}
        <div className="pocan-chips">
          <span className="pocan-chip pocan-chip--id">{target.po}</span>
          {target.supplier && <span className="pocan-chip">{target.supplier}</span>}
          {target.balance > 0 && <span className="pocan-chip pocan-chip--amt">{money(target.balance)} still open</span>}
        </div>
        <div className="pocan-note">
          <IcoWarn />
          <span>This cannot be undone. With nothing paid on it, the order moves straight to the <b>PO Cancellation Closed</b> tab.</span>
        </div>
        <div className="pocan-ft">
          <button type="button" className="pocan-btn pocan-btn--keep" disabled={busy} onClick={onClose}>No, keep it</button>
          <button type="button" className="pocan-btn pocan-btn--go" disabled={busy} onClick={onConfirm}>
            <IcoCancel /><span>{busy ? 'Cancelling…' : 'Yes, cancel PO'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Money has gone out: the refund adjustment comes first, and raising it initiates the cancellation. */
function RefundGate({ target, onClose, onCreateRefund }: Props) {
  const money = moneyIn(target.currency);
  useScrollLock(true, '.porec-bd');
  useEscape(onClose);
  const step = (n: number, t: string, s: string, state: 'now' | 'next') => (
    <div className={`pocn-step is-${state}`}>
      <span className="pocn-step__n">{n}</span>
      <div><div className="pocn-step__t">{t}</div><div className="pocn-step__s">{s}</div></div>
      {state === 'now' && <span className="pocn-step__now">You are here</span>}
    </div>
  );
  return createPortal(
    <div className="porec-modal is-open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="porec-box pocn-box" role="dialog" aria-modal="true" aria-label="Create advance refund">
        <div className="porec-hd">
          <div className="porec-hd__ico"><IcoDoc /></div>
          <div>
            <div className="porec-hd__t">Create Advance Receipt Refund Adjustment</div>
            <div className="porec-hd__s">{target.po}{target.supplier ? ` · ${target.supplier}` : ''} — needed before any payment can be recovered</div>
          </div>
          <button type="button" className="porec-hd__x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>
        <div className="porec-bd">
          <div className="pocn-hero">
            <span className="pocn-hero__ico"><IcoWallet /></span>
            <span className="pocn-hero__txt">
              <span className="pocn-hero__lbl">Already released to supplier</span>
              <div className="pocn-hero__amt">{money(target.paid)}</div>
              <div className="pocn-hero__sub">{target.supplier || 'This supplier'} · {target.po}</div>
            </span>
          </div>
          <div className="pocn-lead">
            Money has been released on this order, so cancelling it starts with the <b>Advance Receipt Refund Adjustment</b> — the
            document that makes the refund owed. Raising it cancels the order straight away; the refund is then recovered against it.
          </div>
          <div className="pocn-steps">
            {step(1, 'Raise the refund adjustment', `Opens the adjustment form for ${money(target.paid)}`, 'now')}
            {step(2, 'Order moves to Cancellation Initiated', 'Listed under PO Cancellation Initiated (Recovery Pending)', 'next')}
            {step(3, 'Recover the refund', 'Log refunds until nothing is outstanding — the order then moves to PO Cancellation Closed', 'next')}
          </div>
          <div className="pocn-hint"><IcoInfo /><span>Recovery is recorded from the order’s <b>Manage Recovery</b> button, not from Cancel PO.</span></div>
        </div>
        <div className="porec-ft">
          <button type="button" className="pocn-btn pocn-btn--ghost" onClick={onClose}>Not now</button>
          <button type="button" className="pocn-btn pocn-btn--go" onClick={onCreateRefund}><IcoPlus /><span>Create Advance Receipt Refund Adjustment</span></button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
