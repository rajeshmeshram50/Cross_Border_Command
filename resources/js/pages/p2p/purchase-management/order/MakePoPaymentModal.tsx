import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import type { OrderRow } from './Order';
import {
  Box, HeroRefChips, ICON_X, PoSummaryCards, TdsStrip, initials, money, shortDate,
} from './payment-shared';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';
import './make-po-payment.css';

const AddPaymentModal = lazy(() => import('./AddPaymentModal'));

export type ReleasePayment = {
  amount: number;
  bank: string;
  utr: string;
  date: string;
  file?: string;
};

export type MakePoPaymentProps = {
  row: OrderRow;
  requestId: string;
  requestDate: string;
  requestType: string;
  requestedAmount: number;
  approved: number;
  approver: string;
  approverRole: string;
  alreadyPaid: number;
  payments: ReleasePayment[];
  tds: number;
  onRecord: (p: ReleasePayment) => void;
  onUpdate: (index: number, p: ReleasePayment) => void;
  onDelete: (index: number) => void;
  onOpenTds: () => void;
  onClose: () => void;
};

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_CARD = (
  <svg {...ic}><rect x="2" y="5" width="20" height="14" rx="2.5" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
);
const ICON_PLUS = (
  <svg {...ic} strokeWidth={2.6}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const ICON_TICK = <svg {...ic} strokeWidth={3.2} className="cpay-tick"><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_DOC = (
  <svg {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
);
const ICON_EYE = (
  <svg {...ic} strokeWidth={2.4}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const ICON_DL = (
  <svg {...ic} strokeWidth={2.4}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const ICON_MAIL = (
  <svg {...ic} strokeWidth={2.4}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>
);
const ICON_EDIT = (
  <svg {...ic} strokeWidth={2.4}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1z" /></svg>
);
const ICON_DEL = (
  <svg {...ic} strokeWidth={2.4}>
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

function Field({ label, mod, children }: { label: string; mod?: string; children: React.ReactNode }) {
  return (
    <div className={`cpay-f${mod ? ' ' + mod : ''}`}>
      <label>{label}</label>
      <div className={`cpay-v${mod === 'cpay-f--hi' ? ' cpay-v--hi' : ''}`}>{children}</div>
    </div>
  );
}

export default function MakePoPaymentModal({
  row, requestId, requestDate, requestType, requestedAmount, approved, approver, approverRole,
  alreadyPaid, payments, tds, onRecord, onUpdate, onDelete, onOpenTds, onClose,
}: MakePoPaymentProps) {
  useScrollLock(true, '.mpr-card--pay');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const closeForm = () => { setAdding(false); setEditing(null); };

  const released = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const paidOnRequest = alreadyPaid + released;
  const room = Math.max(0, approved - paidOnRequest);
  const pct = row.net > 0 ? Math.round((requestedAmount / row.net) * 1000) / 10 : 0;

  const poPaid = row.paid + released;
  const poBalance = Math.max(0, row.net - poPaid);

  return createPortal(
    <div className="spi-mdl-backdrop">
      {(adding || editing !== null) && (
        <Suspense fallback={null}>
          <AddPaymentModal
            key={editing ?? 'new'}
            requestId={requestId}
            supplier={row.supplier}
            poNumber={row.po}
            spiNumber={row.invoices[0]?.spi}
            spiCount={row.invoices.length}
            approved={approved}
            paid={paidOnRequest}
            initial={editing !== null ? payments[editing] : undefined}
            onClose={closeForm}
            onSave={(p) => {
              if (editing !== null) onUpdate(editing, p);
              else onRecord(p);
              closeForm();
            }}
          />
        </Suspense>
      )}

      <div className="spi-mdl mpr-card mpr-card--pay" role="dialog" aria-modal="true" aria-labelledby="cpay-title" tabIndex={-1} ref={cardRef}>

        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_CARD}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="cpay-title">Payment Against Request ID</span>
              <span className="mpr-hero__idpill">{requestId}</span>
            </div>
            <div className="mpr-hero__sub">Release the approved amount on this request</div>
          </div>
          <HeroRefChips row={row} />
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">

          <Box
            label="Request"
            title={`Current Request Details (${requestId})`}
            sub="The request this release is being made against · read-only"
          >
            <div className="cpay-grid">
              <Field label="Payment Request ID"><span className="cpay-id">{requestId}</span></Field>
              <Field label="Payment Type"><span className="cpay-type">{requestType}</span></Field>
              <Field label="Payment %" mod="cpay-f--pct">
                <span className="cpay-pct">{pct}%</span>
                <span className="cpay-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
              </Field>
              <Field label="Requested Payment Amount">{money(requestedAmount)}</Field>
              <Field label="Requested To" mod="cpay-f--who">
                <span className="cpay-av">{initials(approver)}</span>
                <span className="cpay-whotxt">
                  {approver}
                  <span className="cpay-role">{approverRole}</span>
                </span>
              </Field>
              <Field label="Request Approval Status" mod="cpay-f--st">
                <span className="mpr-st mpr-st--done"><span className="mpr-st__dot" />Approved</span>
              </Field>
              <Field label="Approved Amount" mod="cpay-f--hi">
                {money(approved)}
                {ICON_TICK}
              </Field>
            </div>
          </Box>

          <Box
            label="Summary"
            title="PO Payment Details Summary"
            sub="How this PO’s value is made up and where it stands today · read-only"
            headerExtra={!row.cancelled && (
              <TdsStrip tds={tds} total={row.total} supplier={row.supplier} onOpen={onOpenTds} />
            )}
          >
            <PoSummaryCards
              total={row.total}
              paid={poPaid}
              balance={poBalance}
              net={row.net}
              complete={poBalance <= 0}
            />
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">Payment History</span>
              <span className="mpr-panel__c">{payments.length}</span>
              <span className="cpay-panel__s">Released against {requestId}</span>
              <button
                type="button"
                className="cpay-add"
                disabled={room <= 0}
                onClick={() => setAdding(true)}
                title={room > 0
                  ? 'Record a payment against this request'
                  : 'Fully released — nothing left approved on this request'}
              >
                {ICON_PLUS}<span>Add New Payment</span>
              </button>
            </div>

            <div className="mpr-table">
              <div className="cpay-cols cpay-cols--head">
                <span>Sr. No</span>
                <span>Paid Against Request ID</span>
                <span>Request Raised Against</span>
                <span>Paid Amount</span>
                <span>Bank Name</span>
                <span>UTR / Cheque Number</span>
                <span>UTR / Cheque Date</span>
                <span>Proof Of Payment</span>
                <span>Action</span>
              </div>

              {payments.length === 0 ? (
                <div className="cpay-empty">
                  <div className="cpay-empty__ico">{ICON_CARD}</div>
                  <div className="cpay-empty__t">No payments recorded yet</div>
                  <div className="cpay-empty__s">Use Add New Payment to record a release against this request.</div>
                </div>
              ) : payments.map((p, i) => (
                <div className="cpay-cols cpay-row" key={`${p.utr}-${i}`}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Paid Against Request ID">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{requestId}</span>
                      <span className="mpr-iddate">{shortDate(requestDate)}</span>
                    </span>
                  </span>
                  <span data-l="Request Raised Against">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{row.po}</span>
                      <span className="mpr-iddate">{shortDate(row.poDate)}</span>
                    </span>
                  </span>
                  <span data-l="Paid Amount"><b className="cpay-amt">{money(p.amount)}</b></span>
                  <span data-l="Bank Name"><span className="cpay-bank">{p.bank || '—'}</span></span>
                  <span data-l="UTR / Cheque Number"><span className="cpay-utr">{p.utr || '—'}</span></span>
                  <span data-l="UTR / Cheque Date"><span className="cpay-date">{p.date || '—'}</span></span>
                  <span data-l="Proof Of Payment">
                    {p.file ? (
                      <span className="cpay-file">
                        <span className="cpay-file__ico">{ICON_DOC}</span>
                        <span className="cpay-file__name" title={p.file}>{p.file}</span>
                        <span className="cpay-file__sep" />
                        <span className="cpay-fbtns">
                          <button type="button" className="cpay-fbtn cpay-fbtn--view" title="View proof of payment">{ICON_EYE}</button>
                          <button type="button" className="cpay-fbtn cpay-fbtn--dl" title="Download proof of payment">{ICON_DL}</button>
                        </span>
                      </span>
                    ) : <span className="cpay-noproof">Not attached</span>}
                  </span>
                  <span data-l="Action">
                    <span className="cpay-acts">
                      <button
                        type="button"
                        className="cpay-act cpay-act--mail"
                        disabled={!p.file}
                        title={p.file
                          ? `Send ${p.file} to the supplier by email`
                          : 'No proof attached to send — attach one first'}
                      >
                        {ICON_MAIL}
                      </button>
                      <button type="button" className="cpay-act cpay-act--edit" title="Edit payment" onClick={() => setEditing(i)}>{ICON_EDIT}</button>
                      <button type="button" className="cpay-act cpay-act--del" title="Delete payment" onClick={() => onDelete(i)}>
                        {ICON_DEL}
                      </button>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Previous</button>
            <button type="button" className="spi-mdl-confirm" onClick={onClose}>Submit</button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
