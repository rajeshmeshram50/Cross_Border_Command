// Recover Payment — every refund received against one Advance Receipt Refund
// Adjustment, with the summary above it. Built on the Order module's payment
// popups: mpr-hero / Box / Stat (Manage Payment Requests) and the cpay-* payment
// list (Make PO Payment). Each row syncs its own refund to Zoho Books.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadFile } from '../../../../utils/downloadFile';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { Box, Chip, ICON_X, STAT_ICONS, Stat, money, shortDate } from '../../purchase-management/order/manage-payment/payment-shared';
import { PoApiError, refundApi, type RecoveryBody } from '../../purchase-management/order/api/po-api';
import { IcoCheck, IcoDocSm, IcoDownload, IcoEye, IcoPencil, IcoPlus, IcoRefund, IcoTrash } from '../../icons';
import { FitTip } from '../../purchase-management/order/create-po/form-fields';
import AddRecoveryModal from './AddRecoveryModal';
import { refundFigures, toRefund, type RefundAdjustment, type RefundRecovery } from './refund-data';
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

const errText = (e: unknown) => (e instanceof PoApiError ? e.firstError : 'Please try again.');

/** Every proof on a recovery; a row saved before the list existed reports only the one. */
const proofsOf = (r: RefundRecovery) =>
  r.proofs?.length
    ? r.proofs.map((p) => ({ key: p.path, name: p.name, url: p.url }))
    : r.file && r.fileUrl ? [{ key: r.fileUrl, name: r.file, url: r.fileUrl }] : [];

const ICON_SYNC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><polyline points="21 3 21 8 16 8" /><polyline points="3 21 3 16 8 16" />
  </svg>
);

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

  const applied = (r: RefundAdjustment) => {
    setRefund(r);
    onChanged();
  };

  const save = async (body: RecoveryBody) => {
    if (!refund) return false;
    try {
      const res = editing === -1 || editing === null
        ? await refundApi.addRecovery(refund.id, body)
        : await refundApi.updateRecovery(refund.id, editing, body);
      toast.success(editing === -1 ? 'Recovered payment added' : 'Recovered payment updated', `${money(body.amount)} against ${refund.no}`);
      applied(toRefund(res.refund));
      setEditing(null);
      return true;
    } catch (e) {
      /* A refused field belongs on that field in the form — the popup marks it
         red and says why. Everything else is a toast, as before. */
      if (e instanceof PoApiError && e.status === 422) throw e;
      toast.error('Could not save the recovered payment', errText(e));
      return false;
    }
  };

  const remove = async (id: number, amount: number) => {
    if (!refund || busy) return;
    setBusy(`del-${id}`);
    const ok = await confirm({
      title: 'Delete recovered payment?',
      message: `${money(amount)} will be removed from ${refund.no} and counted as outstanding again. This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep It',
      tone: 'danger',
      // The popup holds until the entry is gone, rather than closing on the press.
      busyLabel: 'Deleting…',
      onConfirm: async () => {
        try {
          const res = await refundApi.deleteRecovery(refund.id, id);
          applied(toRefund(res.refund));
          toast.success('Recovered payment deleted');
        } catch (e) {
          toast.error('Could not delete the recovered payment', errText(e));
        }
      },
    });
    void ok;
    setBusy(null);
  };

  // Pushes the vendor credit first if it is not in Zoho yet, then this refund.
  const syncRow = async (id: number) => {
    if (!refund || busy) return;
    setBusy(`zoho-${id}`);
    try {
      const res = await refundApi.syncRecovery(refund.id, id);
      applied(toRefund(res.refund));
      toast.success('Refund synced to Zoho Books', res.message ?? undefined);
    } catch (e) {
      toast.error('Zoho Books sync failed', errText(e));
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
            {/* A PO raised without a shipment, opportunity or procurement reads
                "N/A" — the same wording the payment request detail uses, not a
                dash that looks like the value failed to load (CS-591). */}
            <Chip label="Shipment ID" value={po?.shipment || 'N/A'} />
            <Chip label="Opportunity ID" value={po?.opportunity || 'N/A'} />
            <Chip label="Procurement ID" value={po?.procurement || 'N/A'} />
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
                <div className="cpay-cols cpay-row arf-rec-cols" key={r.id}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Recovered Amount"><b className="cpay-amt">{money(r.amount)}</b></span>
                  <span data-l="Refunded Date"><span className="cpay-date">{shortDate(r.date)}</span></span>
                  <span data-l="Reference No. (Cheque / UTR)">
                    {/* Cut with "…" when it doesn't fit; the tooltip then shows it whole. */}
                    <FitTip label={r.reference || '—'}><span className="cpay-utr">{r.reference || '—'}</span></FitTip>
                  </span>
                  <span data-l="Proof Of Payment">
                    {/* A recovery can carry several proofs; each one is listed with
                        its own View and Download (CS-567). */}
                    {proofsOf(r).length ? (
                      <span className="cpay-files">
                        {proofsOf(r).map((f) => (
                          <span className="cpay-file" key={f.key}>
                            <span className="cpay-file__ico"><IcoDocSm /></span>
                            <span className="cpay-file__name" title={f.name}>{f.name}</span>
                            <span className="cpay-file__sep" />
                            <span className="cpay-fbtns">
                              <button type="button" className="cpay-fbtn cpay-fbtn--view" title="View proof of payment" onClick={() => openFile(f.url)}><IcoEye /></button>
                              <button type="button" className="cpay-fbtn cpay-fbtn--dl" title="Download proof of payment"
                                onClick={() => void downloadFile(f.url, f.name)}><IcoDownload /></button>
                            </span>
                          </span>
                        ))}
                      </span>
                    ) : <span className="cpay-noproof">Not attached</span>}
                  </span>
                  <span data-l="Action">
                    <span className="cpay-acts">
                      {r.zohoStatus === 'synced' ? (
                        <span className="arf-zoho arf-zoho--ok" title="Refunded against the vendor credit in Zoho Books"><IcoCheck />Synced</span>
                      ) : (
                        <button type="button" className="arf-recsync" disabled={busy !== null}
                          title={r.zohoError ?? 'Refund this amount against the vendor credit in Zoho Books'}
                          onClick={() => void syncRow(r.id)}>
                          {ICON_SYNC}<span>{busy === `zoho-${r.id}` ? 'Syncing…' : 'Zoho Sync'}</span>
                        </button>
                      )}
                      {/* Synced to Zoho, or the refund fully recovered — either way
                          the entry is a record now, so it opens to be read (CS-566). */}
                      <button type="button" className="cpay-act cpay-act--edit" disabled={r.zohoStatus === 'synced' || done}
                        title={r.zohoStatus === 'synced' ? 'Refunded in Zoho Books — this entry can no longer be changed'
                          : done ? 'Fully recovered — this entry can no longer be changed' : 'Edit recovered payment'}
                        onClick={() => setEditing(r.id)}>{r.zohoStatus === 'synced' || done ? <IcoEye /> : <IcoPencil />}</button>
                      <button type="button" className={`cpay-act cpay-act--del${busy === `del-${r.id}` ? ' is-busy' : ''}`}
                        disabled={r.zohoStatus === 'synced' || done || busy !== null}
                        title={r.zohoStatus === 'synced' ? 'Refunded in Zoho Books — this entry can no longer be deleted'
                          : done ? 'Fully recovered — this entry can no longer be deleted'
                            : busy === `del-${r.id}` ? 'Deleting…' : 'Delete recovered payment'}
                        onClick={() => void remove(r.id, r.amount)}>
                        {busy === `del-${r.id}` ? <span className="cpay-act__ring" aria-hidden /> : <IcoTrash />}
                      </button>
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
