// Recover Payment — every refund received against one Advance Receipt Refund
// Adjustment, with the summary above it. Built on the Order module's payment
// popups: mpr-hero / Box / Stat (Manage Payment Requests) and the cpay-* payment
// list (Make PO Payment). Each recovery is a Zoho vendor-credit refund.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { Box, Chip, ICON_X, STAT_ICONS, Stat, money, shortDate } from '../../purchase-management/order/manage-payment/payment-shared';
import { PoApiError, refundApi, type RecoveryBody, type ZohoOutcome } from '../../purchase-management/order/api/po-api';
import { IcoCheck, IcoDocSm, IcoDownload, IcoEye, IcoPencil, IcoPlus, IcoRefund, IcoTrash } from '../../icons';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import AddRecoveryModal from './AddRecoveryModal';
import { refundFigures, toRefund, type RefundAdjustment } from './refund-data';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/manage-payment/manage-payment-requests.css';
import '../../purchase-management/order/manage-payment/make-po-payment.css';
import './advance-refund.css';

type Props = {
  refundId: number;
  /** Something changed — the list behind reloads its figures. */
  onChanged: () => void;
  onClose: () => void;
};

const SYNC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><polyline points="21 3 21 8 16 8" /><polyline points="3 21 3 16 8 16" />
  </svg>
);

const errText = (e: unknown) => (e instanceof PoApiError ? e.firstError : 'Please try again.');

export default function RecoverPaymentModal({ refundId, onChanged, onClose }: Props) {
  useScrollLock(true, '.mpr-card');
  const toast = useToast();
  const confirm = useConfirm();
  const [refund, setRefund] = useState<RefundAdjustment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // null = form closed, -1 = adding, otherwise the recovery id being edited.
  const [editing, setEditing] = useState<number | null>(null);
  // While the add/edit form is open, Esc belongs to it.
  useEscapeClose(editing !== null ? () => {} : onClose);

  const load = useCallback(() => {
    refundApi.show(refundId)
      .then((d) => setRefund(toRefund(d)))
      .catch((e) => { toast.error('Could not load the refund adjustment', errText(e)); onClose(); });
  }, [refundId, toast, onClose]);
  useEffect(() => { load(); }, [load]);

  const applied = (r: RefundAdjustment, zoho: ZohoOutcome) => {
    setRefund(r);
    onChanged();
    if (zoho?.status === 'failed') toast.warning('Saved — Zoho Books sync failed', zoho.message ?? 'Use Zoho Sync on the row to try again.');
  };

  const save = async (body: RecoveryBody) => {
    if (!refund) return false;
    try {
      const res = editing === -1 || editing === null
        ? await refundApi.addRecovery(refund.id, body)
        : await refundApi.updateRecovery(refund.id, editing, body);
      toast.success(editing === -1 ? 'Recovered payment added' : 'Recovered payment updated', `${money(body.amount)} against ${refund.no}`);
      applied(toRefund(res.refund), res.zoho);
      setEditing(null);
      return true;
    } catch (e) {
      toast.error('Could not save the recovered payment', errText(e));
      return false;
    }
  };

  const remove = async (id: number, amount: number, inZoho: boolean) => {
    if (!refund) return;
    const ok = await confirm({
      title: 'Delete recovered payment?',
      message: `${money(amount)} will be removed from ${refund.no} and counted as outstanding again.${inZoho ? ' Its refund is also removed from Zoho Books.' : ''}`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(`del-${id}`);
    try {
      const res = await refundApi.deleteRecovery(refund.id, id);
      applied(toRefund(res.refund), null);
      toast.success('Recovered payment deleted');
    } catch (e) {
      toast.error('Could not delete the recovered payment', errText(e));
    } finally {
      setBusy(null);
    }
  };

  const syncRow = async (id: number) => {
    if (!refund) return;
    setBusy(`sync-${id}`);
    try {
      const res = await refundApi.syncRecovery(refund.id, id);
      applied(toRefund(res.refund), null);
      toast.success('Synced to Zoho Books', 'The refund is recorded against the vendor credit.');
    } catch (e) {
      toast.error('Zoho Books sync failed', errText(e));
      load();
    } finally {
      setBusy(null);
    }
  };

  const syncCredit = async () => {
    if (!refund) return;
    setBusy('vc');
    try {
      const res = await refundApi.zohoSync(refund.id);
      applied(toRefund(res.refund), null);
      toast.success('Vendor credit synced to Zoho Books', 'Applied to the PO bill; the rest is the refund owed.');
    } catch (e) {
      toast.error('Zoho Books sync failed', errText(e));
      load();
    } finally {
      setBusy(null);
    }
  };

  const openFile = (url?: string) => { if (url) window.open(url, '_blank', 'noopener'); };

  if (!refund) {
    return createPortal(
      <div className="spi-mdl-backdrop">
        <div className="spi-mdl mpr-card arf-rec" role="dialog" aria-modal="true" aria-busy="true">
          <div className="mpr-bd"><div className="cpay-empty"><div className="cpay-empty__t">Loading refund adjustment…</div></div></div>
        </div>
      </div>,
      document.body,
    );
  }

  const po = refund.poInfo;
  const fig = refundFigures(refund);
  const done = fig.pending <= 0;
  const editingRow = editing !== null && editing >= 0 ? refund.recoveries.find((r) => r.id === editing) : undefined;

  return createPortal(
    <div className="spi-mdl-backdrop">
      {editing !== null && (
        <AddRecoveryModal
          refund={refund}
          outstanding={fig.pending}
          initial={editingRow}
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
            <Chip label="Supplier" value={po?.supplier ?? '—'} meta={po?.supplierCode} mod="mpr-hero__chip--sup" />
            <Chip label="PO Number" value={refund.po} meta={po?.poDate ? shortDate(po.poDate) : undefined} />
            <Chip label="Advance Receipt Refund Adjustment" value={refund.no} meta={shortDate(refund.date)} />
            <Chip label="Shipment ID" value={po?.shipment || '—'} />
            <Chip label="Opportunity ID" value={po?.opportunity ?? '—'} />
            <Chip label="Procurement ID" value={po?.procurement ?? '—'} />
          </div>
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          {/* The vendor credit must be in Zoho before any refund can be recorded there. */}
          {refund.zohoStatus !== 'synced' && (
            <div className="arf-zbar">
              <span>
                <b>Vendor credit not in Zoho Books yet.</b>{' '}
                {refund.zohoError ?? 'It is created against the PO bill; recoveries are refunded against it.'}
              </span>
              <button type="button" className="ord-btn ord-btn--zoho arf-sync" disabled={busy === 'vc'} onClick={() => void syncCredit()}>
                {SYNC}<span>{busy === 'vc' ? 'Syncing…' : 'Sync Vendor Credit'}</span>
              </button>
            </div>
          )}

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
                <div className="cpay-cols cpay-row arf-rec-cols" key={r.id}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Recovered Amount"><b className="cpay-amt">{money(r.amount)}</b></span>
                  <span data-l="Refunded Date"><span className="cpay-date">{shortDate(r.date)}</span></span>
                  <span data-l="Reference No. (Cheque / UTR)">
                    {/* Cut with "…" when it doesn't fit; the tooltip then shows it whole. */}
                    <FitTip label={r.reference || '—'}><span className="cpay-utr">{r.reference || '—'}</span></FitTip>
                  </span>
                  <span data-l="Proof Of Payment">
                    {r.file ? (
                      <span className="cpay-file">
                        <span className="cpay-file__ico"><IcoDocSm /></span>
                        <span className="cpay-file__name" title={r.file}>{r.file}</span>
                        <span className="cpay-file__sep" />
                        <span className="cpay-fbtns">
                          <button type="button" className="cpay-fbtn cpay-fbtn--view" title="View proof of payment" onClick={() => openFile(r.fileUrl)}><IcoEye /></button>
                          <a className="cpay-fbtn cpay-fbtn--dl" title="Download proof of payment" href={r.fileUrl} download={r.file}><IcoDownload /></a>
                        </span>
                      </span>
                    ) : <span className="cpay-noproof">Not attached</span>}
                  </span>
                  <span data-l="Action">
                    <span className="cpay-acts">
                      {r.zohoStatus === 'synced'
                        ? <span className="arf-zoho arf-zoho--ok" title="Recorded as a vendor-credit refund in Zoho Books"><IcoCheck /> Zoho Synced</span>
                        : (
                          <button type="button" className="ord-btn ord-btn--zoho arf-sync" disabled={busy === `sync-${r.id}`}
                            title={r.zohoError ?? 'Record this refund in Zoho Books'} onClick={() => void syncRow(r.id)}>
                            {SYNC}<span>{busy === `sync-${r.id}` ? 'Syncing…' : r.zohoStatus === 'failed' ? 'Retry Zoho' : 'Zoho Sync'}</span>
                          </button>
                        )}
                      <button type="button" className="cpay-act cpay-act--edit" title="Edit recovered payment" onClick={() => setEditing(r.id)}><IcoPencil /></button>
                      <button type="button" className="cpay-act cpay-act--del" title="Delete recovered payment" disabled={busy === `del-${r.id}`}
                        onClick={() => void remove(r.id, r.amount, r.zohoStatus === 'synced')}><IcoTrash /></button>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {done && (
            <div className="mpr-done">
              <span className="mpr-done__ico"><IcoCheck /></span>
              <span><b>Full amount recovered</b> — {money(fig.toRefund)} has come back against {refund.no}. The PO cancellation is closed.</span>
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
