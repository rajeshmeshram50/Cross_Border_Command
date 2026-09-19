import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './deduct-tds.css';

const money = (v: number) => '₹' + Math.round(v || 0).toLocaleString('en-IN');

const round2 = (v: number) => Math.round(v * 100) / 100;

const ico = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_TDS = (
  <svg {...ico} strokeWidth={2.2}>
    <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);

const ICON_X = (
  <svg {...ico} strokeWidth={2.6}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export type DeductTdsProps = {
  po: string;
  base: number;
  gst: number;
  extra: number;
  total: number;
  room: number;
  saved: number;
  onSave: (amount: number) => void;
  onClose: () => void;
};

function Readonly({ label, value }: { label: string; value: number }) {
  return (
    <div className="mtds-f">
      <label>{label}</label>
      <div className="mtds-v">{money(value)}</div>
    </div>
  );
}

export default function DeductTdsModal({
  po, base, gst, extra, total, room, saved, onSave, onClose,
}: DeductTdsProps) {
  useScrollLock(true, '.mtds-card');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [pctText, setPctText] = useState(saved > 0 && base > 0 ? String(round2((saved / base) * 100)) : '');
  const [amtText, setAmtText] = useState(saved > 0 ? String(saved) : '');
  const [typed, setTyped] = useState(saved);

  const amount = Math.min(Math.max(0, typed), room);
  const capped = typed > room;
  const net = Math.max(0, total - amount);
  const pctOfBase = base > 0 ? round2((amount / base) * 100) : 0;

  const fromPct = (v: string) => {
    setPctText(v);
    const p = parseFloat(v);
    const a = Number.isNaN(p) || p < 0 ? 0 : Math.round((base * p) / 100);
    setAmtText(a ? String(a) : '');
    setTyped(a);
  };

  const fromAmt = (v: string) => {
    setAmtText(v);
    const a = parseFloat(v);
    const clean = Number.isNaN(a) || a < 0 ? 0 : Math.round(a);
    setPctText(base > 0 && clean ? String(round2((clean / base) * 100)) : '');
    setTyped(clean);
  };

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="mtds-card" role="dialog" aria-modal="true" aria-labelledby="mtds-title" tabIndex={-1} ref={cardRef}>

        <div className="mtds-hd">
          <span className="mtds-hd__ico">{ICON_TDS}</span>
          <div className="mtds-hd__ttl" id="mtds-title">
            Deduct TDS Value from the total PO value
            <span className="mtds-hd__sub">
              {po} · figures derived from the PO · enter the deduction to compute the net payable
            </span>
          </div>
          <button type="button" className="mtds-hd__x" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mtds-bd">
          <div className="mtds-grid">
            <Readonly label="PO Base Amount (Without GST)" value={base} />
            <Readonly label="GST Amount" value={gst} />
            <Readonly label="Extra Charges" value={extra} />
            <Readonly label="Total PO Amount (Grand Total)" value={total} />

            <div className="mtds-f mtds-f--in">
              <label htmlFor="mtds-pct">
                TDS Deduction (%)
                <span className="mtds-link" title="These two fields are linked">⇄</span>
              </label>
              <div className="mtds-inwrap">
                <input
                  id="mtds-pct"
                  className="mtds-in"
                  inputMode="decimal"
                  placeholder="0"
                  value={pctText}
                  onChange={(e) => fromPct(e.target.value)}
                />
                <span className="mtds-suffix">%</span>
              </div>
            </div>

            <div className="mtds-f mtds-f--in">
              <label htmlFor="mtds-amt">
                TDS Amount
                <span className="mtds-link" title="These two fields are linked">⇄</span>
              </label>
              <div className="mtds-inwrap">
                <span className="mtds-prefix">₹</span>
                <input
                  id="mtds-amt"
                  className="mtds-in"
                  inputMode="decimal"
                  placeholder="0"
                  value={amtText}
                  onChange={(e) => fromAmt(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="mtds-foot">
            <span className="mtds-note">
              {amount > 0 ? (
                <>
                  <b>{pctOfBase}%</b> of the {money(base)} base = <b>{money(amount)}</b> withheld ·
                  supplier receives <b>{money(net)}</b>
                  {capped && <> · <span className="mtds-cap">capped at the {money(room)} still unsettled</span></>}
                </>
              ) : (
                <>
                  TDS is calculated on the PO base amount of <b>{money(base)}</b> · without GST or extra charges ·
                  fill either field and the other follows · up to {money(room)} can be withheld
                </>
              )}
            </span>
          </div>
        </div>

        <div className="mtds-ft">
          {saved > 0 && (
            <button type="button" className="spi-mdl-cancel mtds-remove" onClick={() => onSave(0)}>
              Remove Deduction
            </button>
          )}
          <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="spi-mdl-confirm"
            disabled={amount === saved}
            onClick={() => onSave(amount)}
          >
            Save TDS Deduction
          </button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
