// Create / edit an Advance Receipt Refund Adjustment — full-page form, opened
// after the PO is picked (or straight away when editing). Reuses the shared P2P
// wizard shell (spi-dt-*) and its Field / EditSelect / HeadPill pieces.
// Raising it cancels the PO; the vendor credit then goes to Zoho Books.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { downloadFile } from '../../../../utils/downloadFile';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import Tooltip from '../../../../components/ui/Tooltip';
import { Field, EditSelect } from '../../purchase-management/order/create-po/form-fields';
import { HeadPill } from '../../purchase-management/order/create-po/CreatePoForm';
import { money, shortDate } from '../../purchase-management/order/manage-payment/payment-shared';
import { PoApiError, poLookupApi, refundApi, type SupplierDetail, type ZohoOutcome } from '../../purchase-management/order/api/po-api';
import { categoryLabel } from '../../purchase-management/order/create-po/supplier-checks';
import {
  IcoAlert, IcoCamera, IcoCart, IcoChevron, IcoChevronL, IcoChevronR, IcoDocSm, IcoDownload, IcoEye, IcoLock, IcoPaperclip,
  IcoShield, IcoUser, IcoX,
} from '../../icons';
import EvidenceVaultModal from './EvidenceVaultModal';
import { REFUND_TYPES, RETAIN_REASONS, toPoInfo, toRefund, todayIso, type RefundAdjustment, type RefundPoInfo } from './refund-data';
import { useEscapeClose } from './useEscapeClose';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import './advance-refund.css';

type Props = {
  /** The PO a new adjustment is raised against. */
  poId?: number;
  /** An existing adjustment to edit. */
  editId?: number;
  onSaved: (r: RefundAdjustment, zoho: ZohoOutcome) => void;
  /** Back to the PO picker (create) or close (edit). */
  onCancel: () => void;
  onClose: () => void;
};

const MAX_FILE = 2 * 1024 * 1024;
const PO_TYPE_LABEL: Record<string, string> = { material_goods: 'Material / Goods', services: 'Services', ffd_transporter: 'FFD / Transporter' };

/* Between the pills: three faint dots, as in the prototype — not a text glyph. */
const Dots = () => <span className="arf-dots" aria-hidden><i /><i /><i /></span>;

const IcoRef = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 7h16M4 12h10M4 17h7" />
  </svg>
);

/** Server field → the form field it marks. */
const FIELD_OF: Record<string, string> = {
  refund_type: 'type', reason: 'reason', refund_amount: 'amount', retained_type: 'retainedType', retained_remark: 'retainedRemark', attachment: 'attachment',
};

export default function RefundAdjustmentForm({ poId, editId, onSaved, onCancel, onClose }: Props) {
  // Freeze the page behind, but keep the form's own scroller working.
  useScrollLock(true, '.spi-dt-overlay');
  const toast = useToast();
  const [info, setInfo] = useState<RefundPoInfo | null>(null);
  const [edit, setEdit] = useState<RefundAdjustment | null>(null);
  const [code, setCode] = useState('');
  const [sup, setSup] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [supplierRef, setSupplierRef] = useState('');
  const [attachment, setAttachment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState('');
  const [reason, setReason] = useState('');
  const [amtText, setAmtText] = useState('');
  const [retainedType, setRetainedType] = useState('');
  const [retainedRemark, setRetainedRemark] = useState('');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState({ po: true, sup: true, refund: true });
  const [vault, setVault] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  // The PO (new) or the adjustment (edit), then the supplier from the master.
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        let po: RefundPoInfo | null = null;
        if (editId) {
          const r = toRefund(await refundApi.show(editId));
          if (!live) return;
          setEdit(r); setCode(r.no); po = r.poInfo;
          setSupplierRef(r.supplierRef); setAttachment(r.attachment ?? ''); setType(r.type); setReason(r.reason);
          setAmtText(String(r.amount)); setRetainedType(r.retainedType); setRetainedRemark(r.retainedRemark);
        } else if (poId) {
          const d = await refundApi.forPo(poId);
          if (!live) return;
          setCode(d.next_code); po = toPoInfo(d.po);
        }
        setInfo(po);
        if (po?.vendorId) {
          const s = await poLookupApi.supplier(po.vendorId).catch(() => null);
          if (live) setSup(s);
        }
      } catch (e) {
        if (!live) return;
        toast.error('Could not open the refund adjustment', e instanceof PoApiError ? e.firstError : 'Please try again.');
        onClose();
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, editId]);

  // Esc closes the vault first when it is open (it registers its own handler).
  useEscapeClose(vault || saving ? () => {} : onClose);

  const paid = edit?.paid ?? info?.paid ?? 0;
  const recovered = edit?.recovered ?? 0;
  const locked = !!edit?.amountsLocked;
  /* Every rupee is back: the refund is closed and the form only opens to be
     read — the server refuses the save too (CS-588). */
  const settled = edit?.status === 'recovered';
  const po = info?.po ?? '—';
  // Blank amount means "refund everything paid", as the placeholder shows.
  const amount = amtText.trim() === '' ? paid : Math.max(0, Math.round((parseFloat(amtText) || 0) * 100) / 100);
  const short = amount < paid ? Math.round((paid - amount) * 100) / 100 : 0;

  const clear = (k: string) => setInvalid((x) => ({ ...x, [k]: false }));
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // Full refund returns everything; picking it fills the amount in.
  const pickType = (v: string) => {
    setType(v); clear('type');
    if (v === 'Full Refund') { setAmtText(String(paid)); clear('amount'); }
  };

  const submit = async () => {
    const full = type === 'Full Refund';
    const bad = {
      type: !type || (full && short > 0) || (!full && !!type && short <= 0),
      reason: reason.trim().length < 3,
      amount: amount <= 0 || amount > paid || amount < recovered,
      retainedType: short > 0 && !retainedType,
      retainedRemark: short > 0 && !retainedRemark.trim(),
    };
    setInvalid(bad);
    if (!type) { toast.warning('Refund type required', 'Select the advance refund type.'); return; }
    if (reason.trim().length < 3) { toast.warning('Reason required', 'Say why this refund is being raised (at least 3 characters).'); return; }
    if (amount <= 0) { toast.warning('Refund amount required', 'Enter the amount to be refunded.'); return; }
    if (amount > paid) { toast.warning('Amount too high', `The refund cannot exceed the ${money(paid)} paid on this PO.`); return; }
    if (amount < recovered) { toast.warning('Amount too low', `${money(recovered)} has already been recovered on this refund.`); return; }
    if (full && short > 0) { toast.warning('Full refund must return everything', `A full refund is the whole ${money(paid)} — choose Partial Refund to keep part of it back.`); return; }
    if (!full && short <= 0) { toast.warning('Partial refund must be less', 'A partial refund is less than the amount paid — choose Full Refund to return all of it.'); return; }
    if (bad.retainedType || bad.retainedRemark) {
      toast.warning('Explain the amount kept', `Say why ${money(short)} is not being refunded before continuing.`);
      return;
    }

    setSaving(true);
    try {
      const body = {
        supplier_ref_no: supplierRef.trim() || undefined, attachment: file,
        refund_type: type, reason: reason.trim(), refund_amount: amount,
        retained_type: short > 0 ? retainedType : undefined, retained_remark: short > 0 ? retainedRemark.trim() : undefined,
      };
      const res = editId ? await refundApi.update(editId, body) : await refundApi.create({ ...body, purchase_order_id: poId });
      onSaved(toRefund(res.refund), res.zoho);
    } catch (e) {
      if (e instanceof PoApiError) {
        const marks: Record<string, boolean> = {};
        Object.keys(e.fieldErrors).forEach((k) => { if (FIELD_OF[k]) marks[FIELD_OF[k]] = true; });
        setInvalid((x) => ({ ...x, ...marks }));
        toast.error(editId ? 'Could not update the refund adjustment' : 'Could not raise the refund adjustment', e.firstError);
      } else {
        toast.error('Could not save', 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const pickFile = (f: File | null, cam = false) => {
    if (f && f.size > MAX_FILE) { toast.error('File too large', 'The attachment must be 2 MB or smaller.'); return; }
    // A camera capture arrives as a JPEG with no name on some devices.
    if (f && !cam && !/\.(pdf|jpe?g|png|webp)$/i.test(f.name)) { toast.error('File type not allowed', 'Attach a PDF or an image (JPG, PNG, WEBP).'); return; }
    setFile(f); setAttachment(f ? (f.name || `photo_${Date.now()}.jpg`) : ''); clear('attachment');
  };
  // What View / Download open: the file just picked, else the one already saved.
  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);
  const attUrl = localUrl ?? edit?.attachmentUrl ?? null;

  // What the vault shows while the form is open: the saved record, or the PO being raised against.
  const vaultRefund: RefundAdjustment | null = edit;

  return createPortal(
    <div className="spi-dt-overlay arf-form">
      <div className="spi-dt">
        <div className="spi-dt-topcard">
          <div className="spi-dt-head">
            {loading ? (
              <>
                <div className="spi-dt-head-l">
                  <div className="spi-dt-sk spi-dt-sk-ico" />
                  <div className="arf-sk-mid">
                    <div className="spi-dt-sk spi-dt-sk-line arf-sk-w280" />
                    <div className="spi-dt-sk spi-dt-sk-line arf-sk-w160 arf-sk-thin" />
                  </div>
                </div>
                <div className="spi-dt-pills" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => <div key={i} className="spi-dt-sk arf-sk-hpill" />)}
                </div>
              </>
            ) : (<>
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDocSm /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Advance Receipt Refund Adjustment (Supplier Tax Invoice Not Generated)</div>
                <div className="spi-dt-head-sub">{edit ? 'Editing' : 'Draft'} · against {po}</div>
              </div>
            </div>
            <div className="spi-dt-pills">
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value={info?.supplier ?? '—'} />
              <Dots />
              <HeadPill icon={<IcoRef />} label="PO NUMBER" value={po} alt mono />
              <Dots />
              <HeadPill icon={<IcoRef />} label="SHIPMENT ID" value={info?.shipment ?? '—'} mono />
              <Dots />
              <HeadPill icon={<IcoRef />} label="OPPORTUNITY ID" value={info?.opportunity ?? '—'} alt mono />
              <Dots />
              <HeadPill icon={<IcoRef />} label="PROCUREMENT ID" value={info?.procurement ?? '—'} mono />
            </div>
            </>)}
            <div className="spi-dt-head-r">
              <span className="spi-dt-divider" />
              <Tooltip label={vaultRefund ? 'Refund, PO and payment proofs' : 'Available once the refund adjustment is raised'} themed>
                <button type="button" className="spi-dt-btn-pay" disabled={loading || !vaultRefund} onClick={() => setVault(true)}><IcoShield /> Evidence Vault</button>
              </Tooltip>
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>
        </div>

        {loading ? <FormSkeleton fullSupplier /> : (
        // A settled refund is read from end to end: one disabled fieldset turns it all off.
        <fieldset className="spi-dt-body arf-body" disabled={settled}>
          <Section icon={<IcoCart />} label="Purchase Order" title="Purchase Order Details" sub="The order this refund is raised against"
            badge="Read-only" open={open.po} onToggle={() => toggle('po')}>
            <div className="arf-rogrid">
              <Ro label="PO NUMBER" value={po} mono />
              <Ro label="PO TYPE" value={info?.poType ? (PO_TYPE_LABEL[info.poType] ?? info.poType) : '—'} />
              <Ro label="DOCUMENT TYPE" value={info?.docType ?? '—'} />
              <Ro label="EXPECTED DELIVERY DATE" value={info?.expectedDelivery ? shortDate(info.expectedDelivery) : '—'} />
              <Ro label="PO PAYMENT TYPE" value={info?.paymentType ?? '—'} />
              <Ro label="MODE OF TRANSPORT" value={info?.transport ?? '—'} />
              <Ro label="PHYSICAL INSPECTION REQUIRED" value={info?.physicalInspection ? 'Yes' : 'No'} />
              <Ro label="TOTAL PO AMOUNT (GRAND TOTAL)" value={money(info?.total ?? 0)} />
              <Ro label="TDS DEDUCTED" value={money(info?.tds ?? 0)} />
              <Ro label="NET PAYABLE AMOUNT" value={money(info?.net ?? 0)} />
              <Ro label="TOTAL PAID AMOUNT" value={money(paid)} hl />
              <Ro label="BALANCE AMOUNT" value={money(info?.balance ?? 0)} />
            </div>
          </Section>

          <Section icon={<IcoUser />} label="Supplier" title="Supplier Details" sub="Party the refund is due from"
            badge={sup ? 'Read-only' : 'Partial'} open={open.sup} onToggle={() => toggle('sup')}>
            {sup ? (
              <div className="arf-rogrid arf-rogrid--sup">
                <Ro label="SUPPLIER" value={`${sup.code} — ${sup.name}`} />
                <Ro label="COMPANY LEGAL NAME" value={sup.legalName ?? ''} />
                <Ro label="SUPPLIER TYPE" value={sup.type ?? ''} />
                <Ro label="SUPPLIER CATEGORY" value={categoryLabel(sup.category)} />
                <Ro label="SUPPLIER SEGMENT" value={sup.segments.join(', ')} />
                <Ro label="SUPPLIER RISK LEVEL" value={sup.risk ?? ''} />
                <Ro label="GST IN / TIN" value={sup.gstNo ?? ''} mono />
                <Ro label="GST STATUS" value={sup.gstStatus ?? ''} />
                <Ro label="REGISTERED OFFICE ADDRESS" value={sup.addr ?? ''} span2 />
                <Ro label="COUNTRY" value={sup.country ?? ''} />
                <Ro label="STATE" value={sup.state ?? ''} />
                <Ro label="STATE CODE" value={sup.stateCode ?? ''} mono />
                <Ro label="CITY" value={sup.city ?? ''} />
                <Ro label="CONTACT PERSON NAME" value={sup.contact ?? ''} />
                <Ro label="DESIGNATION" value={sup.desig ?? ''} />
                <Ro label="CONTACT NUMBER" value={sup.phone ?? ''} mono />
                <Ro label="EMAIL ID" value={sup.email ?? ''} />
              </div>
            ) : (
              <>
                <div className="arf-rogrid">
                  <Ro label="SUPPLIER" value={info?.supplier ?? '—'} />
                  <Ro label="SUPPLIER CODE" value={info?.supplierCode ?? '—'} mono />
                </div>
                <div className="arf-miss">
                  Full supplier record could not be loaded from the supplier master — only the details carried on the purchase order are shown.
                </div>
              </>
            )}
          </Section>

          <Section icon={<IcoDocSm />} label="Refund" title="Advance Receipt Refund Adjustment Details"
            sub="Identity of this refund and the amount due back from the supplier" badge="Auto" open={open.refund} onToggle={() => toggle('refund')}>
            {settled ? (
              <div className="arf-miss">Fully recovered — {money(recovered)} is back from the supplier, so this refund adjustment is closed and opens for reading only.</div>
            ) : locked && (
              <div className="arf-miss">The vendor credit is already in Zoho Books ({edit?.zohoNumber ?? 'synced'}) — the refund type and amounts can no longer change.</div>
            )}
            <div className="arf-rgrid">
              <Auto label="ADVANCE REFUND NO." value={code} />
              <Auto label="ADVANCE REFUND DATE" value={shortDate(edit?.date || todayIso())} />
              <Field label="SUPPLIER ADVANCE REFUND REFERENCE NO. (OPTIONAL)">
                <input className="spi-dt-inp" placeholder="As issued by the supplier" maxLength={64} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
              </Field>
              <Field label="REFUND REFERENCE ATTACHMENT">
                {/* Browse or shoot it on the spot, and open what is attached (CS-588). */}
                <div className={`spi-dt-file is-clickable${invalid.attachment ? ' is-invalid' : ''}`} role="button" tabIndex={0} onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}>
                  <span className="spi-dt-file-txt"><IcoPaperclip /> {attachment || 'Choose file… (PDF / image, max 2 MB)'}</span>
                  <span className="arf-fileacts" onClick={(e) => e.stopPropagation()}>
                    {attUrl && (
                      <>
                        <Tooltip label="Open this attachment">
                          <a className="spi-dt-file-btn arf-fbtn" href={attUrl} target="_blank" rel="noopener noreferrer" aria-label="View attachment"><IcoEye size={13} /> View</a>
                        </Tooltip>
                        <Tooltip label="Download this attachment">
                          <button type="button" className="spi-dt-file-btn arf-fbtn" aria-label="Download attachment"
                            onClick={() => void downloadFile(attUrl, attachment || 'refund-attachment')}><IcoDownload size={13} /></button>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip label="Take a photo of the reference">
                      <button type="button" className="spi-dt-file-btn arf-fbtn" disabled={settled} aria-label="Take a photo"
                        onClick={() => camRef.current?.click()}><IcoCamera size={13} /> Camera</button>
                    </Tooltip>
                    <button type="button" className="spi-dt-file-btn" disabled={settled} onClick={() => fileRef.current?.click()}>Browse</button>
                  </span>
                  <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden
                    onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
                    onChange={(e) => { pickFile(e.target.files?.[0] ?? null, true); e.target.value = ''; }} />
                </div>
              </Field>
              <Field label="ADVANCE REFUND TYPE" req>
                <EditSelect value={type} options={REFUND_TYPES} placeholder="— Select Refund Type —" invalid={invalid.type}
                  readOnly={locked} onLockedClick={() => toast.info('Refund type is locked', 'The vendor credit is already in Zoho Books.')}
                  onChange={pickType} />
              </Field>
              <Field label="ADVANCE REFUND ADJUSTMENT REASON" req>
                <input className={`spi-dt-inp${invalid.reason ? ' is-invalid' : ''}`} placeholder="Why this refund is being raised" maxLength={500}
                  value={reason} onChange={(e) => { setReason(e.target.value); clear('reason'); }} />
              </Field>
              <Auto label="TOTAL PO AMOUNT (GRAND TOTAL)" value={money(info?.total ?? 0)} />
              <Auto label="TDS DEDUCTED AMOUNT" value={money(info?.tds ?? 0)} />
              <Auto label="NET PAYABLE AMOUNT" value={money(info?.net ?? 0)} />
              <Auto label="TOTAL PAID AMOUNT" value={money(paid)} />
              <Field label="REFUND AMOUNT (AMOUNT TO BE REFUNDED)" req>
                <input type="number" min={0} max={paid} step="0.01" disabled={locked} className={`spi-dt-inp${invalid.amount ? ' is-invalid' : ''}`}
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
                        readOnly={locked} onLockedClick={() => toast.info('Locked', 'The vendor credit is already in Zoho Books.')}
                        onChange={(v) => { setRetainedType(v); clear('retainedType'); }} />
                    </Field>
                  </div>
                  <div className="arf-span2">
                    <Field label="REMARK" req>
                      <input className={`spi-dt-inp${invalid.retainedRemark ? ' is-invalid' : ''}`} placeholder="What these charges cover" maxLength={300}
                        value={retainedRemark} onChange={(e) => { setRetainedRemark(e.target.value); clear('retainedRemark'); }} />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </fieldset>
        )}

        <div className="spi-dt-foot">
          <div className="spi-dt-foot-l">
            <div>
              <div className="spi-dt-foot-step">STEP 01 OF 01</div>
              <div className="spi-dt-foot-name">Purchase Order, Supplier &amp; Refund Details</div>
            </div>
            <div className="spi-dt-dots"><span className="on" /></div>
          </div>
          <div className="spi-dt-foot-r">
            <button type="button" className="spi-dt-btn-ghost" disabled={saving} onClick={onCancel}><IcoChevronL /> {settled ? 'Back' : 'Cancel'}</button>
            {/* Nothing to save on a settled refund — the footer only leaves. */}
            <button type="button" className="spi-dt-btn-next" disabled={loading || saving}
              onClick={() => (settled ? onClose() : void submit())}>
              {settled ? 'Close' : saving ? 'Saving…' : edit ? 'Update Refund Adjustment' : 'Submit Refund Adjustment — Cancel PO'} <IcoChevronR />
            </button>
          </div>
        </div>
      </div>

      {vault && vaultRefund && <EvidenceVaultModal refundId={vaultRefund.id} onClose={() => setVault(false)} />}
      {/* Full-page loader while saving: nothing can be clicked or changed until the server answers. */}
      {saving && (
        <div className="arf-saving" role="alert" aria-busy="true" aria-live="assertive">
          <div className="arf-saving__box">
            <span className="arf-saving__spin" aria-hidden />
            <div className="arf-saving__t">{edit ? 'Updating refund adjustment…' : 'Raising refund adjustment…'}</div>
            <div className="arf-saving__s">{edit ? 'Saving the changes.' : 'Saving the adjustment and cancelling the PO.'} Please wait.</div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/* Shimmer for the form body, on the real grids (.arf-rogrid / .arf-rgrid) so
   it takes the same shape at every width: PO details, supplier details (full
   master record or the short PO-only one) and the refund fields. Bars are the
   shared wizard shimmer (.spi-dt-sk); sizes are in advance-refund.css. */
function FormSkeleton({ fullSupplier }: { fullSupplier: boolean }) {
  const ro = (k: number, span2 = false) => (
    <div key={k} className={`arf-ro${span2 ? ' arf-ro--span2' : ''}`}>
      <span className="spi-dt-sk spi-dt-sk-line arf-sk-l" />
      <span className="spi-dt-sk spi-dt-sk-line arf-sk-v" />
    </div>
  );
  const head = (
    <div className="spi-dt-sec-head">
      <div className="spi-dt-sk spi-dt-sk-ico" />
      <div className="arf-sk-mid">
        <div className="spi-dt-sk spi-dt-sk-line arf-sk-w200" />
        <div className="spi-dt-sk spi-dt-sk-line arf-sk-w280 arf-sk-thin" />
      </div>
      <div className="spi-dt-sk arf-sk-badge" />
      <div className="spi-dt-sk arf-sk-toggle" />
    </div>
  );
  return (
    <div className="spi-dt-body arf-sk" aria-busy="true" aria-label="Loading refund adjustment">
      <div className="spi-dt-sec">
        {head}
        <div className="spi-dt-sec-body"><div className="arf-rogrid">{Array.from({ length: 12 }).map((_, i) => ro(i))}</div></div>
      </div>
      <div className="spi-dt-sec">
        {head}
        <div className="spi-dt-sec-body">
          {fullSupplier
            ? <div className="arf-rogrid arf-rogrid--sup">{Array.from({ length: 17 }).map((_, i) => ro(i, i === 8))}</div>
            : <div className="arf-rogrid">{ro(0)}{ro(1)}</div>}
        </div>
      </div>
      <div className="spi-dt-sec">
        {head}
        <div className="spi-dt-sec-body">
          <div className="arf-rgrid">
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="spi-dt-field">
                <span className="spi-dt-sk spi-dt-sk-line arf-sk-l" />
                <span className="spi-dt-sk spi-dt-sk-field" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
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

