// Create / edit an Advance Receipt Refund Adjustment. Built on the Order module's
// payment-modal shell (spi-mdl + mpr-* + rpr-* form fields) so it matches the
// Request for PO Payment popup 1:1.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useEscapeClose } from './useEscapeClose';
import { ModalSelect } from '../../purchase-management/supplier-purchase-invoice/MapSupplierPurchaseInvoiceModal';
import { Box, HeroRefChips, ICON_X, PoSummaryCards, money, fmtDate } from '../../purchase-management/order/payment-shared';
import { IcoAlert, IcoRefund, IcoWarn } from '../../purchase-management/order/icons';
import {
  REFUNDABLE_POS, REFUND_TYPES, RETAIN_REASONS, findPo, type RefundAdjustment,
} from './refund-data';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/manage-payment-requests.css';
import '../../purchase-management/order/raise-payment-request.css';
import './advance-refund.css';

type Props = {
  /** Existing refund to edit; omitted when raising a new one. */
  edit?: RefundAdjustment;
  nextNo: string;
  today: string;
  /** POs that already carry a refund — they cannot be picked again. */
  takenPos: string[];
  onSubmit: (r: RefundAdjustment) => void;
  onClose: () => void;
};

const toOptions = (list: string[]) => list.map((v) => ({ value: v, label: v }));
const TYPE_OPTIONS = toOptions(REFUND_TYPES);
const RETAIN_OPTIONS = toOptions(RETAIN_REASONS);

export default function RefundAdjustmentModal({ edit, nextNo, today, takenPos, onSubmit, onClose }: Props) {
  useScrollLock();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEscapeClose(onClose);

  const [po, setPo] = useState(edit?.po ?? '');
  const [supplierRef, setSupplierRef] = useState(edit?.supplierRef ?? '');
  const [type, setType] = useState(edit?.type ?? '');
  const [reason, setReason] = useState(edit?.reason ?? '');
  const [amtText, setAmtText] = useState(edit ? String(edit.amount) : '');
  const [retainedType, setRetainedType] = useState(edit?.retainedType ?? '');
  const [retainedRemark, setRetainedRemark] = useState(edit?.retainedRemark ?? '');
  const [error, setError] = useState('');

  const row = po ? findPo(po) : undefined;
  const paid = row?.paid ?? 0;
  const recovered = edit ? edit.recoveries.reduce((s, x) => s + x.amount, 0) : 0;
  const amount = Math.max(0, Math.round(parseFloat(amtText) || 0));
  const short = amount > 0 && amount < paid ? paid - amount : 0;

  const poOptions = useMemo(() => REFUNDABLE_POS
    .filter((r) => !takenPos.includes(r.po))
    .map((r) => ({ value: r.po, label: `${r.po} · ${r.supplier} · ${money(r.paid)} paid` })), [takenPos]);

  const submit = () => {
    if (!row) { setError('Select the purchase order this refund is raised against.'); return; }
    if (!type) { setError('Select the advance refund type.'); return; }
    if (!reason.trim()) { setError('Enter why this refund is being raised.'); return; }
    if (!amount) { setError('Enter the amount to be refunded.'); return; }
    if (amount > paid) { setError(`The refund cannot exceed the ${money(paid)} already paid on this PO.`); return; }
    if (amount < recovered) { setError(`${money(recovered)} has already been recovered — the refund cannot be lower than that.`); return; }
    if (short > 0 && (!retainedType || !retainedRemark.trim())) {
      setError(`Say why ${money(short)} is not being refunded before continuing.`);
      return;
    }
    onSubmit({
      no: edit?.no ?? nextNo,
      date: edit?.date ?? today,
      po: row.po,
      supplierRef: supplierRef.trim(),
      type,
      reason: reason.trim(),
      amount,
      retainedType: short > 0 ? retainedType : '',
      retainedRemark: short > 0 ? retainedRemark.trim() : '',
      recoveries: edit?.recoveries ?? [],
    });
  };

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="spi-mdl mpr-card" role="dialog" aria-modal="true" aria-labelledby="arf-title" tabIndex={-1} ref={cardRef}>

        <div className="mpr-hero">
          <div className="mpr-hero__icon"><IcoRefund size={22} /></div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="arf-title">
                {edit ? 'Edit' : 'Create'} Advance Receipt Refund Adjustment
              </span>
            </div>
            <div className="mpr-hero__sub">The document that makes a refund owed by the supplier</div>
          </div>
          {row && <HeroRefChips row={row} />}
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          <Box label="Purchase Order" title="Link the Purchase Order" sub="Only orders with money already released can carry a refund">
            <div className="rpr-formgrid">
              <div className="rpr-field arf-field--wide">
                <label>Purchase Order</label>
                {edit
                  ? <ReadOnly value={`${edit.po} · ${row?.supplier ?? ''}`} />
                  : <ModalSelect value={po} placeholder="Select purchase order…" options={poOptions} onChange={setPo} />}
              </div>
            </div>
            {row && <PoSummaryCards total={row.total} paid={row.paid} balance={row.balance} net={row.net} complete={row.balance === 0} />}
          </Box>

          <Box label="Refund" title="Advance Receipt Refund Adjustment Details" sub="Identity of this refund and the amount due back from the supplier">
            <div className="rpr-formgrid">
              <div className="rpr-field"><label>Advance Refund No.</label><ReadOnly value={edit?.no ?? nextNo} /></div>
              <div className="rpr-field"><label>Advance Refund Date</label><ReadOnly value={fmtDate(edit?.date ?? today)} /></div>
              <div className="rpr-field">
                <label htmlFor="arf-supref">Supplier Refund Reference No. <span className="rpr-opt">Optional</span></label>
                <div className="rpr-amtwrap">
                  <input id="arf-supref" className="rpr-amtwrap__in" placeholder="As issued by the supplier"
                    value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
                </div>
              </div>
              <div className="rpr-field">
                <label>Advance Refund Type</label>
                <ModalSelect value={type} placeholder="Select refund type…" options={TYPE_OPTIONS} onChange={setType} />
              </div>
              <div className="rpr-field arf-field--wide">
                <label htmlFor="arf-reason">Advance Refund Adjustment Reason</label>
                <div className="rpr-amtwrap">
                  <input id="arf-reason" className="rpr-amtwrap__in" placeholder="Why this refund is being raised"
                    value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              </div>
              <div className="rpr-field arf-field--wide">
                <label htmlFor="arf-amt">Refund Amount (Amount To Be Refunded)</label>
                <div className="rpr-amtwrap">
                  <span className="rpr-amtwrap__cur">₹</span>
                  <input id="arf-amt" type="number" className="rpr-amtwrap__in" min={0} max={paid}
                    placeholder={paid ? String(paid) : '0'} value={amtText} onChange={(e) => setAmtText(e.target.value)} />
                </div>
                <span className={`rpr-amthint${amount > paid ? ' is-err' : ''}`}>
                  {amount > paid ? `Exceeds the ${money(paid)} paid on this PO.` : `Up to ${money(paid)} paid on this PO`}
                </span>
              </div>
            </div>

            {/* Refunding less than was paid leaves a gap the supplier keeps — it must be named. */}
            {short > 0 && (
              <div className="arf-short">
                <div className="arf-short__top">
                  <span className="arf-short__ico"><IcoAlert size={17} /></span>
                  <div className="arf-short__lead">
                    <div className="arf-short__t">Amount not being refunded</div>
                    <div className="arf-short__s">Of {money(paid)} paid, <b>{money(amount)}</b> is being refunded.</div>
                  </div>
                  <div className="arf-short__fig">
                    <span className="arf-short__figl">Retained By Supplier</span>
                    <span className="arf-short__figv">{money(short)}</span>
                    <span className="arf-short__figs">{Math.round((short / paid) * 100)}% of what was paid</span>
                  </div>
                </div>
                <div className="rpr-formgrid">
                  <div className="rpr-field arf-field--wide">
                    <label>Reason For Not Refunded</label>
                    <ModalSelect value={retainedType} placeholder="Select a reason…" options={RETAIN_OPTIONS} onChange={setRetainedType} />
                  </div>
                  <div className="rpr-field arf-field--wide">
                    <label htmlFor="arf-remark">Remark</label>
                    <div className="rpr-amtwrap">
                      <input id="arf-remark" className="rpr-amtwrap__in" placeholder="What these charges cover"
                        value={retainedRemark} onChange={(e) => setRetainedRemark(e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Box>

          {error && <div className="rpr-err"><IcoWarn /><span>{error}</span></div>}
        </div>

        <div className="spi-mdl-foot">
          <div className="mpr-recap">
            <span className="mpr-recap__lbl">Refunding</span>
            <b className="mpr-recap__val">{money(amount)}</b>
            <span className="mpr-recap__sep" />
            <span className={`mpr-recap__type rpr-recap__type${type ? '' : ' is-empty'}`}>{type || 'No type selected'}</span>
          </div>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm mpr-raise" onClick={submit}>
              {edit ? 'Update Refund Adjustment' : 'Submit Refund Adjustment'}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}

/** Auto-filled value — same box as an input, but locked. */
export function ReadOnly({ value }: { value: string }) {
  return (
    <div className="rpr-amtwrap arf-ro" title="Auto — not editable">
      <span className="rpr-amtwrap__in">{value || '—'}</span>
      <span className="arf-ro__tag">Auto</span>
    </div>
  );
}
