// Create / edit an Advance Receipt Refund Adjustment — full-page form, opened
// after the PO is picked (or straight away when editing). Reuses the shared P2P
// wizard shell (spi-dt-*) and its Field / EditSelect / HeadPill pieces.
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import { Field, EditSelect } from '../../purchase-management/order/create-po/form-fields';
import { HeadPill } from '../../purchase-management/order/create-po/CreatePoForm';
import { PO_TYPE } from '../../purchase-management/order/po-list/Order';
import { money, shortDate, supplierCode } from '../../purchase-management/order/manage-payment/payment-shared';
import {
  IcoAlert, IcoCart, IcoChevron, IcoChevronL, IcoChevronR, IcoDocSm, IcoLock, IcoPaperclip,
  IcoShield, IcoUser, IcoX,
} from '../../icons';
import EvidenceVaultModal from './EvidenceVaultModal';
import { REFUND_TYPES, RETAIN_REASONS, findPo, type RefundAdjustment } from './refund-data';
import { supplierByName } from '../payment-request/payment-request-suppliers';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import './advance-refund.css';

type Props = {
  po: string;
  /** Existing refund to edit; omitted when raising a new one. */
  edit?: RefundAdjustment;
  nextNo: string;
  today: string;
  onSubmit: (r: RefundAdjustment) => void;
  /** Back to the PO picker (create) or close (edit). */
  onCancel: () => void;
  onClose: () => void;
};

const MAX_FILE = 2 * 1024 * 1024;

/* The prototype marks every reference pill (PO, shipment, opportunity,
   procurement) with the same three-bar glyph; only the supplier pill differs. */
/* Between the pills: three faint dots, as in the prototype — not a text glyph. */
const Dots = () => <span className="arf-dots" aria-hidden><i /><i /><i /></span>;

const IcoRef = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 7h16M4 12h10M4 17h7" />
  </svg>
);

/* Neither the payment term nor the transport mode is carried on the PO row yet,
   so — as in the prototype — they are derived from the PO number: stable per
   order, not re-rolled on every render. Replace with the real fields when the
   PO record carries them. */
const TERMS = ['Net 30 Days', 'Net 45 Days', 'Net 60 Days', '50% Advance · 50% On Delivery', 'Against Delivery'];
function derivedTerms(po: string, docType: string) {
  const n = Number(po.match(/(\d+)\s*$/)?.[1] ?? 1) || 1;
  const pool = /^inter/i.test(docType) ? ['Sea', 'Air'] : ['Road', 'Rail'];
  return { term: TERMS[n % TERMS.length], transport: pool[n % pool.length] };
}

export default function RefundAdjustmentForm({ po, edit, nextNo, today, onSubmit, onCancel, onClose }: Props) {
  // Freeze the page behind, but keep the form's own scroller working.
  useScrollLock(true, '.spi-dt-overlay');
  const toast = useToast();
  const row = findPo(po);
  const paid = row?.paid ?? 0;
  const tds = row ? Math.max(0, row.total - row.net) : 0;
  const recovered = edit ? edit.recoveries.reduce((s, x) => s + x.amount, 0) : 0;
  const derived = row ? derivedTerms(row.po, row.docType) : { term: '', transport: '' };
  // The full supplier record, when the supplier is on file in the master.
  const sup = row ? supplierByName(row.supplier) : undefined;

  const [supplierRef, setSupplierRef] = useState(edit?.supplierRef ?? '');
  const [attachment, setAttachment] = useState(edit?.attachment ?? '');
  const [type, setType] = useState(edit?.type ?? '');
  const [reason, setReason] = useState(edit?.reason ?? '');
  const [amtText, setAmtText] = useState(edit ? String(edit.amount) : '');
  const [retainedType, setRetainedType] = useState(edit?.retainedType ?? '');
  const [retainedRemark, setRetainedRemark] = useState(edit?.retainedRemark ?? '');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState({ po: true, sup: true, refund: true });
  const [vault, setVault] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Esc closes the vault first when it is open (it registers its own handler).
  useEscapeClose(vault ? () => {} : onClose);

  // Blank amount means "refund everything paid", as the placeholder shows.
  const amount = amtText.trim() === '' ? paid : Math.max(0, Math.round(parseFloat(amtText) || 0));
  const short = amount < paid ? paid - amount : 0;

  const draft: RefundAdjustment = {
    no: edit?.no ?? nextNo,
    date: edit?.date ?? today,
    po,
    supplierRef: supplierRef.trim(),
    attachment,
    type,
    reason: reason.trim(),
    amount,
    retainedType: short > 0 ? retainedType : '',
    retainedRemark: short > 0 ? retainedRemark.trim() : '',
    recoveries: edit?.recoveries ?? [],
  };

  const clear = (k: string) => setInvalid((x) => ({ ...x, [k]: false }));
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  const submit = () => {
    const bad = {
      type: !type,
      reason: !reason.trim(),
      amount: amount <= 0 || amount > paid || amount < recovered,
      retainedType: short > 0 && !retainedType,
      retainedRemark: short > 0 && !retainedRemark.trim(),
    };
    setInvalid(bad);
    if (bad.type) { toast.warning('Refund type required', 'Select the advance refund type.'); return; }
    if (bad.reason) { toast.warning('Reason required', 'Say why this refund is being raised.'); return; }
    if (amount <= 0) { toast.warning('Refund amount required', 'Enter the amount to be refunded.'); return; }
    if (amount > paid) { toast.warning('Amount too high', `The refund cannot exceed the ${money(paid)} paid on this PO.`); return; }
    if (amount < recovered) { toast.warning('Amount too low', `${money(recovered)} has already been recovered on this refund.`); return; }
    if (bad.retainedType || bad.retainedRemark) {
      toast.warning('Explain the amount kept', `Say why ${money(short)} is not being refunded before continuing.`);
      return;
    }
    onSubmit(draft);
  };

  const pickFile = (f: File | null) => {
    if (f && f.size > MAX_FILE) { toast.error('File too large', 'The attachment must be 2 MB or smaller.'); return; }
    setAttachment(f?.name ?? '');
  };

  return createPortal(
    <div className="spi-dt-overlay arf-form">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDocSm /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Advance Receipt Refund Adjustment (Supplier Tax Invoice Not Generated)</div>
                <div className="spi-dt-head-sub">{edit ? 'Editing' : 'Draft'} · against {po}</div>
              </div>
            </div>
            <div className="spi-dt-pills">
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value={row?.supplier ?? '—'} />
              <Dots />
              <HeadPill icon={<IcoRef />} label="PO NUMBER" value={po} alt mono />
              <Dots />
              <HeadPill icon={<IcoRef />} label="SHIPMENT ID" value={row?.shipment ?? '—'} mono />
              <Dots />
              <HeadPill icon={<IcoRef />} label="OPPORTUNITY ID" value={row?.opportunity ?? '—'} alt mono />
              <Dots />
              <HeadPill icon={<IcoRef />} label="PROCUREMENT ID" value={row?.procurement ?? '—'} mono />
            </div>
            <div className="spi-dt-head-r">
              <span className="spi-dt-divider" />
              <Tooltip label="Refund, PO and payment proofs" themed>
                <button type="button" className="spi-dt-btn-pay" onClick={() => setVault(true)}><IcoShield /> Evidence Vault</button>
              </Tooltip>
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>
        </div>

        <div className="spi-dt-body">
          <Section icon={<IcoCart />} label="Purchase Order" title="Purchase Order Details" sub="The order this refund is raised against"
            badge="Read-only" open={open.po} onToggle={() => toggle('po')}>
            <div className="arf-rogrid">
              <Ro label="PO NUMBER" value={po} mono />
              <Ro label="PO TYPE" value={row ? PO_TYPE[row.type].label : '—'} />
              <Ro label="DOCUMENT TYPE" value={row?.docType ?? '—'} />
              <Ro label="EXPECTED DELIVERY DATE" value={row ? shortDate(row.expectedDelivery) : '—'} />
              <Ro label="PO PAYMENT TERM" value={derived.term} />
              <Ro label="MODE OF TRANSPORT" value={derived.transport} />
              <Ro label="PHYSICAL INSPECTION REQUIRED" value={row?.physicalInspection ? 'Yes' : 'No'} />
              <Ro label="TOTAL PO AMOUNT (GRAND TOTAL)" value={money(row?.total ?? 0)} />
              <Ro label="TDS DEDUCTED" value={money(tds)} />
              <Ro label="NET PAYABLE AMOUNT" value={money(row?.net ?? 0)} />
              <Ro label="TOTAL PAID AMOUNT" value={money(paid)} hl />
              <Ro label="BALANCE AMOUNT" value={money(row?.balance ?? 0)} />
            </div>
          </Section>

          <Section icon={<IcoUser />} label="Supplier" title="Supplier Details" sub="Party the refund is due from"
            badge={sup ? 'Read-only' : 'Partial'} open={open.sup} onToggle={() => toggle('sup')}>
            {sup ? (
              <div className="arf-rogrid arf-rogrid--sup">
                <Ro label="SUPPLIER" value={row?.supplier ?? '—'} />
                <Ro label="COMPANY LEGAL NAME" value={sup.legalName} />
                <Ro label="SUPPLIER TYPE" value={sup.type} />
                <Ro label="SUPPLIER CATEGORY" value={sup.category} />
                <Ro label="SUPPLIER SEGMENT" value={sup.segment} />
                <Ro label="SUPPLIER RISK LEVEL" value={sup.risk} />
                <Ro label="GST IN / TIN" value={sup.gstNo} mono />
                <Ro label="GST STATUS" value={sup.gstStatus} />
                <Ro label="REGISTERED OFFICE ADDRESS" value={sup.addr} span2 />
                <Ro label="COUNTRY" value={sup.country} />
                <Ro label="STATE" value={sup.state} />
                <Ro label="STATE CODE" value={sup.stateCode} mono />
                <Ro label="CITY" value={sup.city} />
                <Ro label="CONTACT PERSON NAME" value={sup.contact} />
                <Ro label="DESIGNATION" value={sup.desig} />
                <Ro label="CONTACT NUMBER" value={sup.phone} mono />
                <Ro label="EMAIL ID" value={sup.email} />
              </div>
            ) : (
              <>
                <div className="arf-rogrid">
                  <Ro label="SUPPLIER" value={row?.supplier ?? '—'} />
                  <Ro label="SUPPLIER CODE" value={row ? supplierCode(row.supplier) : '—'} mono />
                </div>
                <div className="arf-miss">
                  Full supplier record is not on file in the supplier master — only the details carried on the purchase order are shown.
                </div>
              </>
            )}
          </Section>

          <Section icon={<IcoDocSm />} label="Refund" title="Advance Receipt Refund Adjustment Details"
            sub="Identity of this refund and the amount due back from the supplier" badge="Auto" open={open.refund} onToggle={() => toggle('refund')}>
            <div className="arf-rgrid">
              <Auto label="ADVANCE REFUND NO." value={draft.no} />
              <Auto label="ADVANCE REFUND DATE" value={shortDate(draft.date)} />
              <Field label="SUPPLIER ADVANCE REFUND REFERENCE NO. (OPTIONAL)">
                <input className="spi-dt-inp" placeholder="As issued by the supplier" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
              </Field>
              <Field label="REFUND REFERENCE ATTACHMENT">
                <div className="spi-dt-file is-clickable" role="button" tabIndex={0} onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}>
                  <span className="spi-dt-file-txt"><IcoPaperclip /> {attachment || 'Choose file…'}</span>
                  <button type="button" className="spi-dt-file-btn" tabIndex={-1}>Browse</button>
                  <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden
                    onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                </div>
              </Field>
              <Field label="ADVANCE REFUND TYPE" req>
                <EditSelect value={type} options={REFUND_TYPES} placeholder="— Select Refund Type —" invalid={invalid.type}
                  onChange={(v) => { setType(v); clear('type'); }} />
              </Field>
              <Field label="ADVANCE REFUND ADJUSTMENT REASON" req>
                <input className={`spi-dt-inp${invalid.reason ? ' is-invalid' : ''}`} placeholder="Why this refund is being raised"
                  value={reason} onChange={(e) => { setReason(e.target.value); clear('reason'); }} />
              </Field>
              <Auto label="TOTAL PO AMOUNT (GRAND TOTAL)" value={money(row?.total ?? 0)} />
              <Auto label="TDS DEDUCTED AMOUNT" value={money(tds)} />
              <Auto label="NET PAYABLE AMOUNT" value={money(row?.net ?? 0)} />
              <Auto label="TOTAL PAID AMOUNT" value={money(paid)} />
              <Field label="REFUND AMOUNT (AMOUNT TO BE REFUNDED)" req>
                <input type="number" min={0} max={paid} className={`spi-dt-inp${invalid.amount ? ' is-invalid' : ''}`}
                  placeholder={String(paid)} value={amtText} onChange={(e) => { setAmtText(e.target.value); clear('amount'); }} />
              </Field>
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
                    <span className="arf-short__figs">{paid > 0 ? Math.round((short / paid) * 100) : 0}% of what was paid</span>
                  </div>
                </div>
                <div className="spi-dt-grid4">
                  <div className="arf-span2">
                    <Field label="REASON FOR NOT REFUNDED" req>
                      <EditSelect value={retainedType} options={RETAIN_REASONS} placeholder="— Select A Reason —" invalid={invalid.retainedType}
                        onChange={(v) => { setRetainedType(v); clear('retainedType'); }} />
                    </Field>
                  </div>
                  <div className="arf-span2">
                    <Field label="REMARK" req>
                      <input className={`spi-dt-inp${invalid.retainedRemark ? ' is-invalid' : ''}`} placeholder="What these charges cover"
                        value={retainedRemark} onChange={(e) => { setRetainedRemark(e.target.value); clear('retainedRemark'); }} />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>

        <div className="spi-dt-foot">
          <div className="spi-dt-foot-l">
            <div>
              <div className="spi-dt-foot-step">STEP 01 OF 01</div>
              <div className="spi-dt-foot-name">Purchase Order, Supplier &amp; Refund Details</div>
            </div>
            <div className="spi-dt-dots"><span className="on" /></div>
          </div>
          <div className="spi-dt-foot-r">
            <button type="button" className="spi-dt-btn-ghost" onClick={onCancel}><IcoChevronL /> Cancel</button>
            <button type="button" className="spi-dt-btn-next" onClick={submit}>
              {edit ? 'Update Refund Adjustment' : 'Submit Refund Adjustment'} <IcoChevronR />
            </button>
          </div>
        </div>
      </div>

      {vault && <EvidenceVaultModal refund={draft} onClose={() => setVault(false)} />}
    </div>,
    document.body,
  );
}

function Section({ icon, label, title, sub, badge, open, onToggle, children }: {
  icon: ReactNode; label: string; title: string; sub: string; badge: string;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className={`spi-dt-sec${open ? '' : ' is-collapsed'}`}>
      <div className="spi-dt-sec-head" role="button" tabIndex={0} aria-expanded={open} onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div className="spi-dt-sec-ico">{icon}</div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">{label}</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">{title}</span>
          </div>
          <div className="spi-dt-sec-sub">{sub}</div>
        </div>
        <span className="spi-dt-fields-badge">{badge}</span>
        <div className="spi-dt-sec-toggle"><IcoChevron /></div>
      </div>
      <div className="spi-dt-sec-body">{children}</div>
    </div>
  );
}

/** One read-only cell: `mono` for codes and numbers, `span2` for the address,
    `hl` for the figure the refund is measured against. */
function Ro({ label, value, hl, mono, span2 }: { label: string; value: string; hl?: boolean; mono?: boolean; span2?: boolean }) {
  return (
    <div className={`arf-ro${hl ? ' arf-ro--key' : ''}${span2 ? ' arf-ro--span2' : ''}`}>
      <span className="arf-ro__l">{label}</span>
      <span className={`arf-ro__v${mono ? ' arf-ro__v--mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function Auto({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className="spi-dt-inp-auto">
        <input className="spi-dt-inp" value={value} readOnly />
        <span className="spi-dt-auto"><IcoLock /> AUTO</span>
      </div>
    </Field>
  );
}

