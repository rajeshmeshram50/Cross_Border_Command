// Approve / Reject a payment request. One dialog, two modes: the request is
// shown read-only exactly as raised, and the approver sets only the decision —
// the amount being sanctioned, or the reason for declining.
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../../../contexts/AuthContext';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { Box, Chip, HeroRefChips, ICON_X, STAT_ICONS, Stat, fmtDate, money } from '../../purchase-management/order/manage-payment/payment-shared';
import { decidePaymentRequest, type PaymentRequestRow } from './paymentRequestData';
import { PoApiError } from '../../purchase-management/order/api/po-api';
import type { PaymentRequestDetail } from './paymentRequestDetailData';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/manage-payment/manage-payment-requests.css';
import '../../purchase-management/order/manage-payment/raise-payment-request.css';
// For the apay-wait veil shown while the decision saves.
import '../../purchase-management/order/manage-payment/add-payment.css';
import './payment-request-decision.css';

/* The live camera the Physical Inspection screen uses. A hidden
   <input type="file" capture="environment"> only opens a camera on a phone —
   on a desktop the attribute is ignored and the ordinary file picker appears,
   which is what "Camera" used to do here. */
const CameraCaptureModal = lazy(() => import('../../purchase-management/order/physical-inspection/CameraCaptureModal'));

export type DecisionMode = 'approve' | 'decline';

const REMARK_MAX = 400;
const REASON_MAX = 300;

const ic = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ICON_OK = <svg {...ic} strokeWidth={2.6}><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_NO = <svg {...ic} strokeWidth={2.5}><circle cx="12" cy="12" r="9" /><line x1="8.2" y1="8.2" x2="15.8" y2="15.8" /></svg>;
const ICON_CLIP = <svg {...ic} strokeWidth={2.3}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>;
const ICON_CAM = <svg {...ic} strokeWidth={2.3}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>;
const ICON_FILE = <svg {...ic} strokeWidth={2.3}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const ICON_ALERT = <svg {...ic} strokeWidth={2.4}><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>;
const ICON_WALLET = <svg {...ic} width="14" height="14" strokeWidth={2.2}><rect x="2" y="7" width="20" height="14" rx="2.5" /><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" /></svg>;

/** `url` is a blob link to the picked file, so the chip can open it (CS-433 / CS-434). */
type Attached = { name: string; size: number; cam: boolean; url: string };

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin', client_admin: 'Client Admin', branch_user: 'Branch User', employee: 'Employee',
};
const initialsOf = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The most that can be sanctioned: what was asked for, capped by what the
    document still has open once other approvals are counted. */
export function approvalCap(detail: PaymentRequestDetail, req: PaymentRequestRow): number {
  const committed = detail.linked
    .filter(r => r.requestId !== req.requestId && r.status === 'approved')
    .reduce((s, r) => s + Math.max(r.approvedAmount ?? 0, r.paid), 0);
  return Math.max(0, Math.min(req.requestedAmount, detail.ledger.net - committed));
}

export default function PaymentRequestDecisionModal({ mode, detail, request, onClose, onDecided }: {
  mode: DecisionMode;
  detail: PaymentRequestDetail;
  /** The request being decided — the open one, or another from the same document. */
  request: PaymentRequestRow;
  onClose: () => void;
  onDecided: (row: PaymentRequestRow) => void;
}) {
  useScrollLock(true, '.prd-dec');
  const { user } = useAuth();
  const approve = mode === 'approve';
  const { doc, ledger, linked, supplier, po } = detail;
  const D = doc.kind === 'spi' ? 'SPI' : 'PO';

  const cap = approvalCap(detail, request);
  const [amtText, setAmtText] = useState(String(Math.min(request.requestedAmount, cap)));
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Attached[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camOpen, setCamOpen] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => { (approve ? cardRef.current : noteRef.current)?.focus(); }, [approve]);
  // The blob links live as long as the dialog does.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => { filesRef.current.forEach(f => URL.revokeObjectURL(f.url)); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const by = {
    code: initialsOf(user?.name ?? 'User'),
    name: user?.name ?? 'Current user',
    role: ROLE_LABEL[user?.user_type ?? ''] ?? 'Approver',
  };

  const amount = Math.max(0, Math.round(parseFloat(amtText) || 0));
  const amtHint = amount > cap
    ? (cap < request.requestedAmount
      ? `Only ${money(cap)} is still open on this document.`
      : `Cannot exceed the ${money(request.requestedAmount)} that was requested.`)
    : amtText !== '' && amount <= 0 ? 'Enter the amount being approved.'
    : amtText !== '' && amount < 1 ? 'The approved amount must be at least ₹1.' : '';

  // Figures as the requester saw them when raising the request.
  const awaiting = linked.filter(r => r.status === 'awaiting').reduce((s, r) => s + r.requestedAmount, 0);
  const approvedUnpaid = Math.max(0, ledger.approvedTotal - ledger.paid);
  const progPct = ledger.total > 0 ? Math.round((ledger.paid / ledger.total) * 100) : 0;

  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(96, Math.max(42, el.scrollHeight))}px`;
  };
  const addFiles = (e: ChangeEvent<HTMLInputElement>, cam: boolean) => {
    const list = Array.from(e.target.files ?? []).map(f => ({
      name: f.name || `photo_${Date.now()}.jpg`, size: f.size, cam, url: URL.createObjectURL(f),
    }));
    e.target.value = '';
    if (list.length) setFiles(cur => [...cur, ...list]);
  };
  /** Photos from the live camera arrive as real Files, same as picked ones. */
  const addShots = (shots: File[]) => {
    if (!shots.length) return;
    setFiles(cur => [...cur, ...shots.map(f => ({
      name: f.name || `photo_${Date.now()}.jpg`, size: f.size, cam: true, url: URL.createObjectURL(f),
    }))]);
  };
  const dropFile = (i: number) => setFiles(cur => {
    URL.revokeObjectURL(cur[i].url);
    return cur.filter((_, ix) => ix !== i);
  });

  const submit = async () => {
    if (approve) {
      if (amount <= 0) { setError('Enter the amount being approved.'); return; }
      if (amount < 1) { setError('The approved amount must be at least ₹1.'); return; }
      if (amount > cap) {
        setError(cap < request.requestedAmount
          ? `Only ${money(cap)} is still open on this ${D} — the rest is already paid or committed to other requests.`
          : `Approved amount cannot exceed the ${money(request.requestedAmount)} that was requested.`);
        return;
      }
    } else if (!note.trim()) {
      setError('A decline needs a reason on record — the requester sees it.');
      noteRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const names = files.map(f => f.name);
      const row = await decidePaymentRequest(request.id, approve
        ? { kind: 'approve', amount, note: note.trim(), files: names, by }
        : { kind: 'decline', reason: note.trim(), files: names, by });
      onDecided(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The decision could not be saved.');
      setSaving(false);
    }
  };

  const ro = (label: string, value: string, mod = '', sub?: string) => (
    <div className="prd-dec__field">
      <label>{label}</label>
      <div className={`prd-dec__ro${mod ? ' ' + mod : ''}`} title={value}>
        {value}{sub && <span className="prd-dec__rosub">{sub}</span>}
      </div>
    </div>
  );

  const max = approve ? REMARK_MAX : REASON_MAX;

  return createPortal(
    <div className="spi-mdl-backdrop prd-dec-layer">
      {camOpen && (
        <Suspense fallback={null}>
          <CameraCaptureModal
            title="Take a photo for this remark"
            namePrefix={approve ? 'approval' : 'decline'}
            subject={`${approve ? 'Approval' : 'Decline'} remark · ${request.requestId}`}
            onAttach={addShots}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
      <div
        className={`spi-mdl mpr-card prd-dec${approve ? '' : ' prd-dec--no'}${saving ? ' is-saving' : ''}`}
        role="dialog" aria-modal="true" aria-labelledby="prd-dec-title" tabIndex={-1} ref={cardRef} aria-busy={saving}
      >
        {saving && (
          <div className="apay-wait" role="status" aria-live="polite">
            <span className="apay-wait__ring" />
            <span className="apay-wait__t">{approve ? 'Approving the request…' : 'Declining the request…'}</span>
            <span className="apay-wait__s">Please wait, the decision is being recorded</span>
          </div>
        )}
        <div className="mpr-hero">
          <div className="mpr-hero__icon">{approve ? ICON_OK : ICON_NO}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="prd-dec-title">
                {approve ? 'Approve Payment Request' : 'Reject / Decline Payment Request'}
              </span>
              <span className="mpr-hero__idpill">{request.requestId}</span>
              <span className="mpr-hero__badge"><span className="mpr-hero__bdot" />Awaiting Approval</span>
            </div>
            <div className="mpr-hero__sub">Decision recorded as {by.name} · {by.role}</div>
          </div>
          {/* A PO request shows the PO's own strip (with its SPIs); a direct SPI has no PO row. */}
          {po ? <HeroRefChips row={po} /> : <div className="mpr-hero__chips">
            <Chip label="Supplier" value={request.supplier} meta={supplier?.code} mod="mpr-hero__chip--sup" />
            <Chip label={`${D} Number`} value={doc.id} meta={fmtDate(doc.date)} />
            <Chip label="Shipment ID" value={request.shipment?.id ?? '—'} meta={request.shipment ? fmtDate(request.shipment.date) : undefined} />
            <Chip label="Opportunity ID" value={request.opportunity?.id ?? '—'} meta={request.opportunity?.date ? fmtDate(request.opportunity.date) : undefined} />
            <Chip label="Procurement ID" value={request.procurement?.id ?? '—'} meta={request.procurement?.date ? fmtDate(request.procurement.date) : undefined} />
          </div>}
          <button type="button" className="mpr-hero__close" onClick={onClose} disabled={saving} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd prd-dec__bd">
          <Box
            label="Payment"
            title="Current Payment Summary"
            sub={`Figures derived from this ${D} · read-only`}
            icon={ICON_WALLET}
            headerExtra={
              <div className="prd-dec__prog" onClick={e => e.stopPropagation()}>
                <span className="prd-dec__progtxt">{money(ledger.paid)} of {money(ledger.total)} · {progPct}% paid</span>
                <span className="prd-dec__progbar"><span style={{ width: `${progPct}%` }} /></span>
              </div>
            }
          >
            <div className="mpr-stats prd-dec__stats">
              <Stat icon={STAT_ICONS.doc} label={`Total ${D} Amount`} value={money(ledger.total)} sub={`Full ${D} value`} />
              <Stat mod="mpr-stat--bal" icon={STAT_ICONS.send} label="Previously Requested Amount" value={money(awaiting)} sub="Pending decision" />
              <Stat mod="mpr-stat--base" icon={STAT_ICONS.clock} label="Total Approved Amount" value={money(approvedUnpaid)} sub="Awaiting disbursement" />
              <Stat mod="mpr-stat--paid" icon={STAT_ICONS.check} label="Previously Paid Amount" value={money(ledger.paid)} sub="Already released" />
              <Stat mod="mpr-stat--gst" icon={STAT_ICONS.wallet} label="Pending Balance Amount" value={money(ledger.balance)} sub={`Open on this ${D}`} />
            </div>
          </Box>

          <Box
            label={approve ? 'Approval' : 'Rejection'}
            title={approve ? 'Request Details & Approval' : 'Request Details & Rejection'}
            sub={approve ? 'Raised details are read-only · set the amount being approved' : 'Raised details are read-only · state why this is being declined'}
            icon={<svg {...ic} width="14" height="14" strokeWidth={2.4}>{approve ? <path d="M20 6 9 17l-5-5" /> : <><circle cx="12" cy="12" r="9" /><line x1="8.2" y1="8.2" x2="15.8" y2="15.8" /></>}</svg>}
          >
            <div className="prd-dec__grid7">
              {ro('Request ID', request.requestId, 'is-id')}
              {ro('Requested Date', fmtDate(request.requestDate))}
              {ro('Requested By', request.requestedBy.name)}
              {ro('Payment Type', request.paymentType)}
              {ro('Payment Percentage', `${request.percentOfTotal}%`, 'is-num')}
              {ro('Requested Payment Amount', money(request.requestedAmount), 'is-amt')}
              {approve ? (
                <div className="prd-dec__field is-live">
                  <label htmlFor="prd-dec-amt">Amount To Be Approved</label>
                  <div className="rpr-amtwrap prd-dec__amt">
                    <span className="rpr-amtwrap__cur">₹</span>
                    <input
                      id="prd-dec-amt" type="number" className="rpr-amtwrap__in" min={0} max={cap} step={1} disabled={saving}
                      value={amtText} onChange={e => { setAmtText(e.target.value); setError(''); }}
                    />
                  </div>
                  {amtHint && <span className="rpr-amthint is-err">{amtHint}</span>}
                </div>
              ) : (
                ro('Request To', request.requestedTo.name, '', request.requestedTo.role)
              )}
            </div>

            <div className="prd-dec__field is-live prd-dec__row2">
              <div className="prd-dec__fieldhd">
                <label htmlFor="prd-dec-note">
                  {approve ? 'Approval Remark' : <>Rejection Reason <span className="prd-dec__req">Required</span></>}
                </label>
                <span className={`rpr-reasoncount${note.length > max - 40 ? ' is-near' : ''}`}>{note.length} / {max}</span>
              </div>
              <div className="prd-dec__remark">
                <textarea
                  id="prd-dec-note" ref={noteRef} className="prd-dec__remarkin" rows={1} maxLength={max} value={note} disabled={saving}
                  placeholder={approve
                    ? 'Why this amount is being approved — conditions, part-approval reason, anything the record should carry'
                    : 'Explain why this request is being declined…'}
                  onChange={e => { setNote(e.target.value); grow(e.target); if (e.target.value.trim()) setError(''); }}
                />
                <div className="prd-dec__remarkacts">
                  <button type="button" className="prd-dec__rbtn" title="Attach a file" disabled={saving} onClick={() => fileRef.current?.click()}>{ICON_CLIP}<span>Upload</span></button>
                  <button type="button" className="prd-dec__rbtn" title="Take a photo" disabled={saving} onClick={() => setCamOpen(true)}>{ICON_CAM}<span>Camera</span></button>
                </div>
              </div>
              <input ref={fileRef} type="file" multiple hidden onChange={e => addFiles(e, false)} />
              {files.length > 0 && (
                <div className="prd-dec__files">
                  {files.map((f, i) => (
                    <span className="prd-dec__file" key={`${f.name}-${i}`}>
                      <span className="prd-dec__fileico">{f.cam ? ICON_CAM : ICON_FILE}</span>
                      {/* The chip opens what was attached — a name alone gives the approver nothing to check. */}
                      <a className="prd-dec__filen" href={f.url} target="_blank" rel="noopener noreferrer" title={`Open ${f.name}`}>{f.name}</a>
                      {f.size > 0 && <span className="prd-dec__filesz">{kb(f.size)}</span>}
                      <button type="button" className="prd-dec__filex" title="Remove" disabled={saving} onClick={() => dropFile(i)}>{ICON_X}</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Box>

          {error && <div className="rpr-err">{ICON_ALERT}<span>{error}</span></div>}
        </div>

        <div className="spi-mdl-foot">
          <div className="mpr-recap">
            <span className="mpr-recap__lbl">{approve ? 'Approving' : 'Declining'}</span>
            <b className="mpr-recap__val">{money(approve ? amount : request.requestedAmount)}</b>
            <span className="mpr-recap__sep" />
            <span className={`mpr-recap__type${approve && amount <= 0 ? ' is-empty' : ''}`}>
              {!approve ? 'returns to the available balance'
                : amount > 0 && amount < request.requestedAmount ? `part of ${money(request.requestedAmount)} requested`
                  : `of ${money(request.requestedAmount)} requested`}
            </span>
          </div>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className={`spi-mdl-confirm prd-dec__submit${approve ? '' : ' is-no'}`} disabled={saving} onClick={submit}>
              {approve ? 'Approve Request' : 'Reject Request'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
