// A purchase order can only carry a currency Zoho Books has enabled. In any
// other it posts there in the org's base currency, silently — which is how an
// SGD order came to sit in the books as ₹700. Said in the GST notice's own
// shell, so the two things that stop a PO read the same way.
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const IcoCoin = (
  <svg {...ic} width="20" height="20">
    <circle cx="12" cy="12" r="9" /><path d="M15 9.5a3.5 3.5 0 1 0 0 5" />
  </svg>
);

export type CurrencyNotice = {
  /** The currency the PO is in, which Zoho Books does not have. */
  currency: string;
  /** What Zoho Books does have, so another can be picked instead. */
  enabled: string[];
  supplier?: string | null;
};

export default function CurrencyNoticeModal({ notice, onClose, onRetry }: {
  notice: CurrencyNotice; onClose: () => void;
  /** Saves again — for once the currency has been added in Zoho Books. */
  onRetry?: () => void;
}) {
  useScrollLock(true, '.cgst-card');

  return createPortal(
    <div className="cgst-backdrop">
      <div className="cgst-card" role="dialog" aria-modal="true" aria-labelledby="ccy-title">
        <div className="cgst-hd cgst-hd--stop">
          <span className="cgst-hd__ico">{IcoCoin}</span>
          <span className="cgst-hd__txt">
            <span className="cgst-hd__t" id="ccy-title">Currency Not in Zoho Books</span>
            <span className="cgst-hd__s">
              {notice.currency}{notice.supplier ? ` · ${notice.supplier}` : ''}
            </span>
          </span>
          <button type="button" className="cgst-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cgst-bd">
          <p className="cgst-lead">
            <b>{notice.currency}</b> is not one of the currencies enabled in your Zoho Books organisation, so this
            purchase order could never reach it. An order in an unknown currency posts there in the organisation's
            base currency instead — the amount crosses over, the currency does not.
          </p>

          <div className="cgst-rows">
            <div className="cgst-row">
              <span className="cgst-row__k">Add it in Zoho</span>
              <span className="cgst-row__v">Settings → Currencies → {notice.currency}</span>
            </div>
            {notice.enabled.length > 0 && (
              <div className="cgst-row">
                <span className="cgst-row__k">Already enabled</span>
                <span className="cgst-row__v">{notice.enabled.join(', ')}</span>
              </div>
            )}
          </div>

          <p className="cgst-lead" style={{ marginBottom: 0 }}>
            Add {notice.currency} in Zoho Books and try again, or pick one from the list above.
          </p>
        </div>

        <div className="cgst-ft">
          <button type="button" className="cgst-btn cgst-btn--ghost" onClick={onClose}>Choose another currency</button>
          {onRetry && (
            <button type="button" className="cgst-btn cgst-btn--stop" onClick={onRetry}>
              I have added it — try again
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
