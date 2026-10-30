import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { shortDesignation } from '../../../../utils/positionHierarchy';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import {
  Box, Stat, STAT_ICONS, ICON_X, ICON_PENCIL, PAYMENT_TYPES, PaymentWait, money,
} from '../order/manage-payment/payment-shared';
import { InvoiceHeroChips } from './payment-chips';
import { PoApiError, poApprovalApi, type GstApprover } from '../order/api/po-api';
import type { InvoiceRow } from './types';
import type { SpiPayFigures, SpiRequestTotals } from './InvoicePaymentsModal';
import type { SpiRaiseBody } from './spi-api';

import '../../p2p-detail.css';
import '../order/manage-payment/manage-payment-requests.css';
import '../order/manage-payment/raise-payment-request.css';

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

const TYPE_OPTIONS = PAYMENT_TYPES.map(t => ({ value: t, label: t }));
const REASON_MAX = 300;

export default function InvoiceRaiseRequestModal({ row, figures, totals, onSubmit, onClose }: {
  row: InvoiceRow;
  figures: SpiPayFigures;
  totals: SpiRequestTotals;
  onSubmit: (body: SpiRaiseBody, approverName: string) => Promise<void>;
  onClose: () => void;
}) {
  const { requested, approvedTotal, pendingAmt, pendingCount, approvedUnpaid, requestCount, available } = totals;
  useScrollLock(true, '.mpr-card--raise');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const [type, setType] = useState('');
  const [pctText, setPctText] = useState('');
  const [amtText, setAmtText] = useState('');
  const [approver, setApprover] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const [approvers, setApprovers] = useState<GstApprover[]>([]);
  const [loadingApprovers, setLoadingApprovers] = useState(true);
  useEffect(() => {
    poApprovalApi.approvers(true)
      .then(setApprovers)
      .catch(() => setError('Could not load the approver list — please reopen this form.'))
      .finally(() => setLoadingApprovers(false));
  }, []);
  const approverOptions = approvers.map(a => ({
    value: String(a.id),
    label: a.emp_code ? `${a.name} (${a.emp_code})` : a.name,
    fullLabel: [a.name, a.department, a.designation].filter(Boolean).join(' · '),
    badges: [
      ...(a.department ? [{ text: a.department, tone: 'gray' as const }] : []),
      ...(a.designation ? [{ text: shortDesignation(a.designation), title: a.designation, tone: 'violet' as const }] : []),
    ],
  }));

  const amount = Math.max(0, Math.round(parseFloat(amtText) || 0));
  const overBudget = amount > available;
  const { base, gst, extra, total, paid, balance, pctPaid } = figures;
  const complete = balance <= 0;
  const progPct = total > 0 ? Math.round((paid / total) * 100) : 0;

  const basis = total;
  const pctOf = (v: number) => (basis > 0 ? Math.round((v / basis) * 1000) / 10 : 0);

  const fromPct = (v: string) => {
    if (v !== '' && (!/^\d{0,3}(\.\d{0,2})?$/.test(v) || parseFloat(v) > 100)) return;
    setPctText(v);
    const p = parseFloat(v);
    const a = Number.isNaN(p) || p < 0 ? 0 : Math.round((basis * p) / 100);
    setAmtText(a ? String(a) : '');
  };
  const fromAmt = (v: string) => {
    if (v !== '' && !/^\d{0,13}(\.\d{0,2})?$/.test(v)) return;
    setAmtText(v);
    const a = parseFloat(v);
    const clean = Number.isNaN(a) || a < 0 ? 0 : a;
    setPctText(clean ? String(pctOf(clean)) : '');
  };
  const pickType = (t: string) => {
    setType(t);
    if (t === 'Balance Payment' && available > 0) {
      const a = Math.round(available);
      setAmtText(String(a));
      setPctText(String(pctOf(a)));
    }
  };

  const submit = async () => {
    if (busy) return;
    if (complete) { setError('This SPI is paid in full — no further payment requests can be raised.'); return; }
    if (available <= 0) {
      setError('The remaining balance is already covered by open requests. Wait for a decision on those before raising another.');
      return;
    }
    if (!amount) { setError('Enter a payment request amount before submitting.'); return; }
    if (amount < 1) { setError('The payment request amount must be at least ₹1.'); return; }
    if (amount > available) { setError(`The requested amount exceeds the ${money(available)} still open to request — the rest is already pending, approved or paid.`); return; }
    if (!type) { setError('Select a payment type before submitting.'); return; }
    if (!reason.trim()) { setError('Enter a payment reason before submitting.'); return; }
    const who = approvers.find(a => String(a.id) === approver);
    if (!who) { setError('Select who this request goes to before submitting.'); return; }

    const pct = parseFloat(pctText);
    setError('');
    setBusy(true);
    try {
      await onSubmit({
        payment_type: type,
        percentage: pct > 0 ? pct : undefined,
        requested_amount: amount,
        reason: reason.trim(),
        requested_to: who.id,
      }, who.name);
    } catch (e) {
      setError(e instanceof PoApiError ? e.firstError : 'Could not raise the request — please try again.');
      setBusy(false);
    }
  };

  const requestStats = useMemo(() => (
    <div className="mpr-stats">
      <Stat icon={STAT_ICONS.doc} label="Total SPI Amount" value={money(total)}
        sub={`${money(balance)} still to be released`} />
      <Stat mod="mpr-stat--base" icon={STAT_ICONS.send} label="Total Requested Amount" value={money(requested)}
        sub={`${requestCount} request${requestCount === 1 ? '' : 's'} raised to date`} />
      <Stat mod="mpr-stat--bal" icon={STAT_ICONS.clock} label="Awaiting For Approval" value={money(pendingAmt)}
        sub={`${pendingCount} with the approver now`} />
      <Stat mod="mpr-stat--gst" icon={STAT_ICONS.check} label="Total Approved Amount" value={money(approvedTotal)}
        sub={`${money(approvedUnpaid)} awaiting release`} />
      <Stat mod="mpr-stat--paid" icon={STAT_ICONS.wallet} label="Total Paid Amount" value={money(paid)}
        sub={`${pctPaid}% of the SPI released`} />
      <Stat mod="mpr-stat--tds" icon={STAT_ICONS.trend} label="Balance Amount" value={money(available)}
        sub={complete ? 'Fully settled' : 'Open to request'} />
    </div>
  ), [total, balance, paid, requested, requestCount, pendingAmt, pendingCount, approvedTotal, approvedUnpaid, pctPaid, available, complete]);

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div
        className={`spi-mdl mpr-card mpr-card--raise${busy ? ' is-busy' : ''}`}
        role="dialog" aria-modal="true" aria-labelledby="inv-rpr-title"
        tabIndex={-1} ref={cardRef} aria-busy={busy}
      >
        {busy && <PaymentWait title="Submitting payment request…" sub="Please wait, the request is being sent to the approver" />}

        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_SEND}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="inv-rpr-title">Request for SPI Payment</span>
            </div>
            <div className="mpr-hero__sub">Raise a payment request on this SPI</div>
          </div>
          <InvoiceHeroChips row={row} />
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close" disabled={busy}>{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          <Box
            label="Summary" title="SPI Payment Details Summary"
            sub="How this SPI's value is made up and where it stands today · read-only"
          >
            <div className="mpr-stats">
              <Stat icon={STAT_ICONS.base} label="SPI Base Amount (Without GST)"
                value={money(base)} sub="Pre-tax invoice value" />
              <Stat mod="mpr-stat--base" icon={STAT_ICONS.trend} label="GST Amount"
                value={money(gst)} sub={base > 0 ? `${Math.round((gst / base) * 1000) / 10}% on the base amount` : 'No GST'} />
              <Stat mod="mpr-stat--bal" icon={STAT_ICONS.truck} label="Extra Charges"
                value={money(extra)} sub={extra > 0 ? 'Freight, packing & other charges' : 'None on this invoice'} />
              <Stat mod="mpr-stat--gst" icon={STAT_ICONS.coin} label="Total SPI Amount (Grand Total)"
                value={money(total)} sub={figures.tds > 0 ? `${money(figures.tds)} TDS withheld` : 'No TDS withheld'} />
              <Stat mod="mpr-stat--paid" icon={STAT_ICONS.rupee} label="Total Paid Amount"
                value={money(paid)} sub={`${pctPaid}% of the SPI released`} />
              <Stat mod="mpr-stat--tds" icon={STAT_ICONS.wallet} label="Balance Amount"
                value={money(balance)} sub={complete ? 'Settled in full' : 'Still to be released'} />
            </div>
          </Box>

          <Box
            label="Request" title="Payment Request Details"
            sub={`${money(paid)} of ${money(total)} paid · ${progPct}% · ${money(available)} open for this request`}
            icon={ICON_PENCIL}
            className="rpr-details-box"
            headerExtra={<div className="rpr-hdstats">{requestStats}</div>}
          >
            <div className="rpr-formgrid">
              <div className="rpr-field">
                <label htmlFor="rpr-type">Payment Type<span className="spi-dt-req">*</span></label>
                <MasterSelect value={type} placeholder="Select type…" options={TYPE_OPTIONS}
                  onChange={pickType} disabled={busy} />
              </div>

              <div className="rpr-field">
                <label htmlFor="rpr-pct">Payment Percentage</label>
                <div className="rpr-amtwrap">
                  <input id="rpr-pct" type="text" inputMode="decimal" className="rpr-amtwrap__in"
                    min={0} max={100} placeholder="0" value={pctText}
                    onChange={e => fromPct(e.target.value)} disabled={busy} />
                  <span className="rpr-amtwrap__cur">%</span>
                </div>
              </div>

              <div className="rpr-field">
                <label htmlFor="rpr-amt">Payment Request Amount<span className="spi-dt-req">*</span></label>
                <div className="rpr-amtwrap">
                  <span className="rpr-amtwrap__cur">₹</span>
                  <input id="rpr-amt" type="text" inputMode="decimal" className="rpr-amtwrap__in"
                    min={0} max={available} placeholder="0" value={amtText}
                    onChange={e => fromAmt(e.target.value)} disabled={busy} />
                </div>
                {overBudget && (
                  <span className="rpr-amthint is-err">
                    Amount exceeds the {money(available)} still open to request.
                  </span>
                )}
              </div>

              <div className="rpr-field">
                <label htmlFor="rpr-approver">Request To<span className="spi-dt-req">*</span></label>
                <MasterSelect value={approver} placeholder={loadingApprovers ? 'Loading…' : 'Select approver…'}
                  loading={loadingApprovers} options={approverOptions} onChange={setApprover} disabled={busy} />
              </div>
            </div>

            <div className="rpr-field rpr-field--reason">
              <div className="rpr-field__hd">
                <label htmlFor="rpr-reason">
                  Payment Reason<span className="spi-dt-req">*</span> <span className="rpr-opt">Payment Note</span>
                </label>
                <span className={`rpr-reasoncount${reason.length > REASON_MAX - 40 ? ' is-near' : ''}`}>
                  {reason.length} / {REASON_MAX}
                </span>
              </div>
              <textarea id="rpr-reason" className="rpr-ta" maxLength={REASON_MAX} value={reason}
                onChange={e => setReason(e.target.value)} disabled={busy}
                placeholder="Explain why this payment should be released…" />
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
            <button type="button" className="spi-mdl-cancel" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="spi-mdl-confirm mpr-raise" onClick={() => void submit()} disabled={busy}>
              {busy ? <><span className="mpr-btnspin" aria-hidden="true" />Submitting…</> : 'Submit Payment Request'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
