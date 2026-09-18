import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { ModalSelect } from '../supplier-purchase-invoice/MapSupplierPurchaseInvoiceModal';
import type { OrderRow } from './Order';
import {
  APPROVERS, Box, HeroRefChips, PAYMENT_TYPES, PoSummaryCards, STAT_ICONS, Stat,
  ICON_X, money,
} from './payment-shared';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';
import './raise-payment-request.css';

export type NewRequest = {
  id: string;
  amount: number;
  pct: number;
  type: string;
  reason: string;
  approver: string;
  role: string;
};

export type RaiseRequestProps = {
  row: OrderRow;
  nextId: string;
  requested: number;
  approvedTotal: number;
  pendingAmt: number;
  pendingCount: number;
  approvedUnpaid: number;
  requestCount: number;
  available: number;
  complete: boolean;
  onSubmit: (req: NewRequest) => void;
  onClose: () => void;
};

const ICON_SEND = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" />
  </svg>
);

const ICON_ALERT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const TYPE_OPTIONS = PAYMENT_TYPES.map((t) => ({ value: t, label: t }));
const APPROVER_OPTIONS = APPROVERS.map((a) => ({ value: a.name, label: `${a.name} · ${a.role}` }));

const REASON_MAX = 300;

export default function RaisePaymentRequestModal({
  row, nextId, requested, approvedTotal, pendingAmt, pendingCount, approvedUnpaid,
  requestCount, available, complete, onSubmit, onClose,
}: RaiseRequestProps) {
  useScrollLock();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [type, setType] = useState('');
  const [pctText, setPctText] = useState('');
  const [amtText, setAmtText] = useState('');
  const [approver, setApprover] = useState(APPROVERS[0].name);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const amount = Math.max(0, Math.round(parseFloat(amtText) || 0));
  const overBudget = amount > available;
  const pctPaid = row.net > 0 ? Math.round((row.paid / row.net) * 100) : 0;
  const progPct = row.total > 0 ? Math.round((row.paid / row.total) * 100) : 0;

  const fromPct = (v: string) => {
    setPctText(v);
    const p = parseFloat(v);
    const a = Number.isNaN(p) || p < 0 ? 0 : Math.round((row.total * p) / 100);
    setAmtText(a ? String(a) : '');
  };

  const fromAmt = (v: string) => {
    setAmtText(v);
    const a = parseFloat(v);
    const clean = Number.isNaN(a) || a < 0 ? 0 : a;
    setPctText(clean && row.total > 0 ? String(Math.round((clean / row.total) * 1000) / 10) : '');
  };

  const submit = () => {
    if (complete) {
      setError('This PO is paid in full — no further payment requests can be raised.');
      return;
    }
    if (available <= 0) {
      setError('The remaining balance is already covered by open requests. Wait for a decision on those before raising another.');
      return;
    }
    if (!amount) { setError('Enter a payment request amount before submitting.'); return; }
    if (amount > available) {
      setError(`The requested amount exceeds the available balance of ${money(available)}.`);
      return;
    }
    if (!type) { setError('Select a payment type before submitting.'); return; }
    if (!reason.trim()) { setError('Enter a payment reason before submitting.'); return; }

    const who = APPROVERS.find((a) => a.name === approver) ?? APPROVERS[0];
    const pct = parseFloat(pctText);
    onSubmit({
      id: nextId,
      amount,
      pct: pct > 0 ? pct : (row.total > 0 ? Math.round((amount / row.total) * 1000) / 10 : 0),
      type,
      reason: reason.trim(),
      approver: who.name,
      role: who.role,
    });
  };

  const requestStats = useMemo(() => (
    <div className="mpr-stats">
      <Stat icon={STAT_ICONS.doc} label="Total PO Amount" value={money(row.total)} sub={`${money(row.net)} net payable`} />
      <Stat mod="mpr-stat--base" icon={STAT_ICONS.send} label="Total Requested Amount" value={money(requested)} sub={`${requestCount} request${requestCount === 1 ? '' : 's'} raised to date`} />
      <Stat mod="mpr-stat--bal" icon={STAT_ICONS.clock} label="Awaiting For Approval" value={money(pendingAmt)} sub={`${pendingCount} with the approver now`} />
      <Stat mod="mpr-stat--gst" icon={STAT_ICONS.check} label="Total Approved Amount" value={money(approvedTotal)} sub={`${money(approvedUnpaid)} awaiting release`} />
      <Stat mod="mpr-stat--paid" icon={STAT_ICONS.wallet} label="Total Paid Amount" value={money(row.paid)} sub={`${pctPaid}% of net payable released`} />
      <Stat mod="mpr-stat--tds" icon={STAT_ICONS.trend} label="Balance Amount" value={money(available)} sub={complete ? 'Fully settled' : 'Open to request'} />
    </div>
  ), [row, requested, requestCount, pendingAmt, pendingCount, approvedTotal, approvedUnpaid, pctPaid, available, complete]);

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl mpr-card" role="dialog" aria-modal="true" aria-labelledby="rpr-title" tabIndex={-1} ref={cardRef}>

        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_SEND}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="rpr-title">Request for PO Payment</span>
            </div>
            <div className="mpr-hero__sub">Raise a payment request on this PO</div>
          </div>
          <HeroRefChips row={row} />
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          <Box
            label="Summary"
            title="PO Payment Details Summary"
            sub="How this PO’s value is made up and where it stands today · read-only"
          >
            <PoSummaryCards total={row.total} paid={row.paid} balance={row.balance} net={row.net} complete={complete} />
          </Box>

          <Box
            label="Request"
            title="Payment Request Details"
            sub={`${money(row.paid)} of ${money(row.total)} paid · ${progPct}% · ${money(available)} open for this request`}
          >
            {requestStats}

            <div className="rpr-formgrid">
              <div className="rpr-field">
                <label htmlFor="rpr-type">Payment Type</label>
                <ModalSelect
                  value={type}
                  placeholder="Select type…"
                  options={TYPE_OPTIONS}
                  onChange={setType}
                />
              </div>

              <div className="rpr-field">
                <label htmlFor="rpr-pct">Payment Percentage</label>
                <div className="rpr-amtwrap">
                  <input
                    id="rpr-pct"
                    type="number"
                    className="rpr-amtwrap__in"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={pctText}
                    onChange={(e) => fromPct(e.target.value)}
                  />
                  <span className="rpr-amtwrap__cur">%</span>
                </div>
              </div>

              <div className="rpr-field">
                <label htmlFor="rpr-amt">Payment Request Amount</label>
                <div className="rpr-amtwrap">
                  <span className="rpr-amtwrap__cur">₹</span>
                  <input
                    id="rpr-amt"
                    type="number"
                    className="rpr-amtwrap__in"
                    min={0}
                    max={available}
                    placeholder="0"
                    value={amtText}
                    onChange={(e) => fromAmt(e.target.value)}
                  />
                </div>
                <span className={`rpr-amthint${overBudget ? ' is-err' : ''}`}>
                  {overBudget
                    ? `Amount exceeds the available balance of ${money(available)}.`
                    : `Up to ${money(available)} available for this request`}
                </span>
              </div>

              <div className="rpr-field">
                <label htmlFor="rpr-approver">Request To</label>
                <ModalSelect
                  value={approver}
                  placeholder="Select approver…"
                  options={APPROVER_OPTIONS}
                  onChange={setApprover}
                />
              </div>
            </div>

            <div className="rpr-field rpr-field--reason">
              <div className="rpr-field__hd">
                <label htmlFor="rpr-reason">
                  Payment Reason <span className="rpr-opt">Payment Note</span>
                </label>
                <span className={`rpr-reasoncount${reason.length > REASON_MAX - 40 ? ' is-near' : ''}`}>
                  {reason.length} / {REASON_MAX}
                </span>
              </div>
              <textarea
                id="rpr-reason"
                className="rpr-ta"
                maxLength={REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this payment should be released…"
              />
            </div>
          </Box>

          {error && (
            <div className="rpr-err">
              {ICON_ALERT}
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="spi-mdl-foot">
          <div className="mpr-recap">
            <span className="mpr-recap__lbl">Requesting</span>
            <b className="mpr-recap__val">{money(amount)}</b>
            <span className="mpr-recap__sep" />
            <span className={`mpr-recap__type rpr-recap__type${type ? '' : ' is-empty'}`}>
              {type || 'No type selected'}
            </span>
          </div>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm mpr-raise" onClick={submit}>
              Submit Payment Request
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
