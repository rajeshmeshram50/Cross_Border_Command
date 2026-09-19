// Recover Payment — every refund received against one Advance Receipt Refund
// Adjustment, with the summary above it. Built on the Order module's payment
// popups: mpr-hero / Box / Stat (Manage Payment Requests) and the cpay-* payment
// list (Make PO Payment). advance-refund.css only sets this list's columns.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { Box, Chip, ICON_X, STAT_ICONS, Stat, money, shortDate, supplierCode } from '../../purchase-management/order/payment-shared';
import { IcoCheck, IcoDocSm, IcoDownload, IcoEye, IcoPencil, IcoPlus, IcoRefund, IcoTrash } from '../../icons';
import AddRecoveryModal from './AddRecoveryModal';
import { findPo, refundFigures, type RefundAdjustment, type RefundRecovery } from './refund-data';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/manage-payment-requests.css';
import '../../purchase-management/order/make-po-payment.css';
import './advance-refund.css';

type Props = {
  refund: RefundAdjustment;
  onChange: (recoveries: RefundRecovery[]) => void;
  onClose: () => void;
};

const SYNC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><polyline points="21 3 21 8 16 8" /><polyline points="3 21 3 16 8 16" />
  </svg>
);

export default function RecoverPaymentModal({ refund, onChange, onClose }: Props) {
  useScrollLock(true, '.mpr-card');
  const toast = useToast();
  const confirm = useConfirm();
  const po = findPo(refund.po);
  const fig = refundFigures(refund);
  const done = fig.pending === 0;

  // null = form closed, -1 = adding, otherwise the index being edited.
  const [editing, setEditing] = useState<number | null>(null);
  // While the add/edit form is open, Esc belongs to it.
  useEscapeClose(editing !== null ? () => {} : onClose);

  const save = (entry: RefundRecovery) => {
    const list = editing === -1 || editing === null
      ? [...refund.recoveries, entry]
      : refund.recoveries.map((r, i) => (i === editing ? entry : r));
    onChange(list);
    toast.success(editing === -1 ? 'Recovered payment added' : 'Recovered payment updated', `${money(entry.amount)} against ${refund.no}`);
    setEditing(null);
  };

  const remove = async (i: number) => {
    const ok = await confirm({
      title: 'Delete recovered payment?',
      message: `${money(refund.recoveries[i].amount)} will be removed from ${refund.no} and counted as outstanding again.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    onChange(refund.recoveries.filter((_, k) => k !== i));
    toast.success('Recovered payment deleted');
  };

  // Refunds run on sample data until the API is connected — no file or Zoho account behind them yet.
  const notYet = (what: string) => toast.info(`${what} not available yet`, 'This works once refunds are connected to the server.');

  return createPortal(
    <div className="spi-mdl-backdrop">
      {editing !== null && (
        <AddRecoveryModal
          refund={refund}
          outstanding={fig.pending}
          initial={editing >= 0 ? refund.recoveries[editing] : undefined}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="spi-mdl mpr-card arf-rec" role="dialog" aria-modal="true" aria-labelledby="arf-rec-title">
        <div className="mpr-hero">
          <div className="mpr-hero__icon"><IcoRefund size={20} /></div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow"><span className="mpr-hero__title" id="arf-rec-title">Recover Payment</span></div>
            <div className="mpr-hero__sub">Against {refund.no}</div>
          </div>
          <div className="mpr-hero__chips">
            <Chip label="Supplier" value={po?.supplier ?? '—'} meta={po ? supplierCode(po.supplier) : undefined} mod="mpr-hero__chip--sup" />
            <Chip label="PO Number" value={refund.po} meta={po ? shortDate(po.poDate) : undefined} />
            <Chip label="Advance Receipt Refund Adjustment" value={refund.no} meta={shortDate(refund.date)} />
            <Chip label="Shipment ID" value={po?.shipment || '—'} />
            <Chip label="Opportunity ID" value={po?.opportunity ?? '—'} />
            <Chip label="Procurement ID" value={po?.procurement ?? '—'} />
          </div>
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          <Box label="Summary" title="PO Payment & Recovery Summary" sub="How this payment stands today · read-only">
            <div className="mpr-stats">
              <Stat mod="mpr-stat--paid" icon={STAT_ICONS.wallet} label="Total PO Paid Amount" value={money(fig.paid)} sub="Released to the supplier" />
              <Stat mod="mpr-stat--tds" icon={STAT_ICONS.coin} label="Amount Not Refunded" value={money(fig.notRefunded)}
                sub={fig.notRefunded > 0 ? (refund.retainedType || 'Retained by supplier') : 'Nothing retained'} />
              <Stat mod="mpr-stat--base" icon={STAT_ICONS.doc} label="Amount To Be Refunded" value={money(fig.toRefund)} sub={`Under ${refund.no}`} />
              <Stat mod="mpr-stat--gst" icon={STAT_ICONS.check} label="Total Recovered Amount" value={money(fig.recovered)} sub={`${fig.pct}% of the refund`} />
              <Stat mod="mpr-stat--bal" icon={STAT_ICONS.clock} label="Balance Amount" value={money(fig.pending)} sub={done ? 'Fully recovered' : 'Still to come back'} />
            </div>
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">Payment Recovery List</span>
              <span className="mpr-panel__c">{refund.recoveries.length}</span>
              <span className="cpay-panel__s">Recovered against {refund.no}</span>
              <button type="button" className="cpay-add" disabled={done} onClick={() => setEditing(-1)}
                title={done ? 'Fully recovered — nothing left to recover' : 'Record a refund received from the supplier'}>
                <IcoPlus size={13} /><span>Add Recovered Payment</span>
              </button>
            </div>

            <div className="mpr-table">
              <div className="cpay-cols cpay-cols--head arf-rec-cols">
                <span>Sr. No</span><span>Recovered Amount</span><span>Refunded Date</span>
                <span>Reference No. (Cheque / UTR)</span><span>Proof Of Payment</span><span>Action</span>
              </div>
              {refund.recoveries.length === 0 ? (
                <div className="cpay-empty">
                  <div className="cpay-empty__ico"><IcoRefund /></div>
                  <div className="cpay-empty__t">Nothing recovered yet</div>
                  <div className="cpay-empty__s">Use Add Recovered Payment to record the first refund from the supplier.</div>
                </div>
              ) : refund.recoveries.map((r, i) => (
                <div className="cpay-cols cpay-row arf-rec-cols" key={`${r.date}-${i}`}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Recovered Amount"><b className="cpay-amt">{money(r.amount)}</b></span>
                  <span data-l="Refunded Date"><span className="cpay-date">{shortDate(r.date)}</span></span>
                  <span data-l="Reference No. (Cheque / UTR)"><span className="cpay-utr">{r.reference || '—'}</span></span>
                  <span data-l="Proof Of Payment">
                    {r.file ? (
                      <span className="cpay-file">
                        <span className="cpay-file__ico"><IcoDocSm /></span>
                        <span className="cpay-file__name" title={r.file}>{r.file}</span>
                        <span className="cpay-file__sep" />
                        <span className="cpay-fbtns">
                          <button type="button" className="cpay-fbtn cpay-fbtn--view" title="View proof of payment" onClick={() => notYet('Proof preview')}><IcoEye /></button>
                          <button type="button" className="cpay-fbtn cpay-fbtn--dl" title="Download proof of payment" onClick={() => notYet('Proof download')}><IcoDownload /></button>
                        </span>
                      </span>
                    ) : <span className="cpay-noproof">Not attached</span>}
                  </span>
                  <span data-l="Action">
                    <span className="cpay-acts">
                      <button type="button" className="ord-btn ord-btn--zoho arf-sync" onClick={() => notYet('Zoho sync')}>{SYNC}<span>Zoho Sync</span></button>
                      <button type="button" className="cpay-act cpay-act--edit" title="Edit recovered payment" onClick={() => setEditing(i)}><IcoPencil /></button>
                      <button type="button" className="cpay-act cpay-act--del" title="Delete recovered payment" onClick={() => remove(i)}><IcoTrash /></button>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {done && (
            <div className="mpr-done">
              <span className="mpr-done__ico"><IcoCheck /></span>
              <span><b>Full amount recovered</b> — {money(fig.toRefund)} has come back against {refund.no}.</span>
            </div>
          )}
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
