import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import type { OrderRow } from './Order';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';

const DeductTdsModal = lazy(() => import('./DeductTdsModal'));

type ReqStatus = 'approved' | 'pending' | 'rejected';

type PaymentRequest = {
  id: string;
  date: string;
  type: string;
  amount: number;
  approver: string;
  role: string;
  status: ReqStatus;
  approved: number;
  paid: number;
};

const money = (v: number) => '₹' + Math.round(v || 0).toLocaleString('en-IN');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  const mon = MONTHS[Number(m) - 1];
  if (!y || !d || !mon) return iso || '—';
  return `${d}-${mon}-${y}`;
}

function shortDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

function shiftIso(iso: string, days: number): string {
  const t = Date.parse((iso || '') + 'T00:00:00Z');
  if (Number.isNaN(t)) return iso || '';
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0] || '?').charAt(0) + (p[1] || '').charAt(0)).toUpperCase();
};

const APPROVERS = [
  { name: 'Sunita Rao', role: 'Finance Controller' },
  { name: 'Amit Shetty', role: 'GM Commercial' },
  { name: 'Rahul Menon', role: 'Finance Manager' },
  { name: 'Priya Nair', role: 'Accounts Head' },
];

const SUPPLIER_CODES: Record<string, string> = {
  'Adani Enterprises': 'S-003',
  'Bharat Forge': 'S-011',
  'Reliance Industries': 'S-001',
  'Infosys Ltd': 'S-024',
  'Larsen & Toubro': 'S-007',
  'JSW Steel': 'S-016',
  'Godrej Industries': 'S-032',
};

function supplierCode(name: string): string {
  if (SUPPLIER_CODES[name]) return SUPPLIER_CODES[name];
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 97;
  return 'S-' + String(h + 1).padStart(3, '0');
}

function buildRequests(row: OrderRow): PaymentRequest[] {
  const n = row.paymentRequests;
  if (n <= 0) return [];

  const ready = row.paymentNote?.kind === 'ready' ? row.paymentNote.amount : 0;
  const awaiting = row.paymentNote?.kind === 'waiting' ? row.paymentNote.amount : 0;
  const extras = (ready > 0 ? 1 : 0) + (awaiting > 0 ? 1 : 0);
  const paidSlots = Math.max(row.paid > 0 ? 1 : 0, n - extras);

  const out: PaymentRequest[] = [];
  const push = (amount: number, status: ReqStatus, paid: number) => {
    const i = out.length;
    const who = APPROVERS[i % APPROVERS.length];
    out.push({
      id: 'PRQ-' + String(i + 1).padStart(3, '0'),
      date: shiftIso(row.poDate, 9 + i * 25),
      type: '',
      amount,
      approver: who.name,
      role: who.role,
      status,
      approved: status === 'approved' ? amount : 0,
      paid,
    });
  };

  if (paidSlots > 0 && row.paid > 0) {
    const each = Math.floor(row.paid / paidSlots);
    for (let i = 0; i < paidSlots; i += 1) {
      const amt = i === paidSlots - 1 ? row.paid - each * (paidSlots - 1) : each;
      push(amt, 'approved', amt);
    }
  }
  if (ready > 0) push(ready, 'approved', 0);
  if (awaiting > 0) push(awaiting, 'pending', 0);

  if (out.length === 0) push(row.balance || row.net, 'pending', 0);

  return out.map((q, i) => ({
    ...q,
    type: out.length === 1 ? 'Partial Payment' : i === out.length - 1 ? 'Balance Payment' : 'Partial Payment',
  }));
}

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_HISTORY = (
  <svg {...ic} strokeWidth={2.2}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /><polyline points="12 7.5 12 12 15 13.6" />
  </svg>
);
const ICON_RUPEE = (
  <svg {...ic}><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>
);
const ICON_EYE = (
  <svg {...ic}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const ICON_CHECK = <svg {...ic} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_CHEVRON = <svg {...ic} width="10" height="10" strokeWidth={2.8}><polyline points="6 9 12 15 18 9" /></svg>;
const ICON_CHART = (
  <svg {...ic} width="14" height="14" strokeWidth={2.4}>
    <path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" />
  </svg>
);
const ICON_TDS = (
  <svg {...ic} strokeWidth={2.4}><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
);
const ICON_X = (
  <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const ICON_WALLET = (
  <svg {...ic} strokeWidth={2.4}>
    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
    <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
);

const statIco = (d: ReactNode) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

function Chip({ label, value, meta, mod, extra }: { label: string; value: string; meta?: string; mod?: string; extra?: ReactNode }) {
  return (
    <div className={`mpr-hero__chip${mod ? ' ' + mod : ''}`}>
      <span className="mpr-hero__chip-lbl">{label}</span>
      <span className="mpr-hero__chip-line">
        <span className="mpr-hero__chip-val">{value}</span>
        {meta && <span className="mpr-hero__chip-meta">{meta}</span>}
        {extra}
      </span>
    </div>
  );
}

function Stat({ mod, icon, label, value, sub }: {
  mod?: string; icon: ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div className={`mpr-stat${mod ? ' ' + mod : ''}`}>
      <div className="mpr-stat__ico">{statIco(icon)}</div>
      <div>
        <div className="mpr-stat__lbl">{label}</div>
        <div className="mpr-stat__val">{value}</div>
        {sub && <div className="mpr-stat__sub">{sub}</div>}
      </div>
    </div>
  );
}

function Box({ label, title, sub, headerExtra, children }: {
  label: string; title: string; sub: string; headerExtra?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`spi-bref mpr-box${open ? '' : ' is-collapsed'}`}>
      <div
        className="spi-bref-head"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); }
        }}
      >
        <div className="spi-bref-ico">{ICON_CHART}</div>
        <div className="spi-bref-mid">
          <div className="spi-bref-row">
            <div className="spi-bref-label">{label}</div>
            <div className="spi-bref-sep" />
            <div className="spi-bref-title">{title}</div>
          </div>
          <div className="spi-bref-sub">{sub}</div>
        </div>
        {headerExtra}
        <div className="spi-bref-toggle">{ICON_CHEVRON}</div>
      </div>
      <div className="spi-bref-body">{children}</div>
    </div>
  );
}

const STATUS: Record<ReqStatus, { cls: string; label: string }> = {
  approved: { cls: 'mpr-st--done', label: 'Approved' },
  pending: { cls: 'mpr-st--wait', label: 'Awaiting Approval' },
  rejected: { cls: 'mpr-st--stop', label: 'Declined' },
};

function payLabel(q: PaymentRequest): string {
  if (q.paid <= 0) return 'Payment pending';
  return q.paid >= q.approved ? 'Paid in full' : 'Partially paid';
}

function RequestRow({ q, index, net }: { q: PaymentRequest; index: number; net: number }) {
  const due = Math.max(0, q.approved - q.paid);
  const st = STATUS[q.status];
  const pct = net > 0 ? Math.round((q.amount / net) * 100) : 0;
  const settled = q.status === 'approved' && q.approved > 0 && due <= 0;

  return (
    <div className={`mpr-row${q.status === 'rejected' ? ' is-closed' : ''}`}>
      <span className="mpr-c mpr-sr" data-l="Sr No">{index + 1}</span>

      <span className="mpr-c" data-l="Payment Request ID">
        <span className="mpr-idcell">
          <span className="mpr-idpill">{q.id}</span>
          <span className="mpr-iddate">{shortDate(q.date)}</span>
        </span>
      </span>

      <span className="mpr-c" data-l="Payment Type"><span className="mpr-type">{q.type}</span></span>
      <span className="mpr-c" data-l="Payment %"><span className="mpr-pct">{pct}%</span></span>
      <span className="mpr-c" data-l="Requested Payment Amount"><b className="mpr-amt">{money(q.amount)}</b></span>

      <span className="mpr-person" data-l="Requested To">
        <span className="mpr-av">{initials(q.approver)}</span>
        <span className="mpr-who">
          <span className="mpr-who__name">{q.approver}</span>
          <span className="mpr-who__role">{q.role}</span>
        </span>
      </span>

      <span className="mpr-c" data-l="Request Approval Status">
        <span className="mpr-stack">
          <span className={`mpr-st ${st.cls}`}><span className="mpr-st__dot" />{st.label}</span>
          {q.status === 'approved' && <span className="mpr-substat">{payLabel(q)}</span>}
        </span>
      </span>

      <span className="mpr-c" data-l="Approved Amount">
        {q.status === 'pending'
          ? <b className="mpr-amt mpr-amt--none">&mdash;</b>
          : <b className={`mpr-amt${q.approved > 0 ? ' is-ok' : ''}`}>{money(q.approved)}</b>}
      </span>

      <span className="mpr-c" data-l="Paid Amount">
        <span className="mpr-stack">
          {q.paid > 0
            ? <b className="mpr-amt is-paid">{money(q.paid)}</b>
            : <b className="mpr-amt mpr-amt--none">&mdash;</b>}
          {due > 0 && q.status === 'approved' && <span className="mpr-substat">{money(due)} due</span>}
        </span>
      </span>

      <span className="mpr-c" data-l="Action">
        <span className="mpr-acts">
          {settled ? (
            <span className="mpr-paid" title={`Released in full against ${q.id}`}>{ICON_CHECK}Paid</span>
          ) : (
            <button
              type="button"
              className="mpr-paybtn"
              disabled={q.status !== 'approved'}
              title={
                q.status === 'pending' ? 'Awaiting approval — payment opens once this request is approved'
                  : q.status === 'rejected' ? 'This request was declined — nothing to pay against it'
                    : `Release ${money(due)} against ${q.id}`
              }
            >
              {ICON_RUPEE}<span>Make PO Payment</span>
            </button>
          )}
          <button type="button" className="mpr-viewbtn" title={`View Payment History — ${q.id}`} aria-label={`View payment history for ${q.id}`}>
            {ICON_EYE}
          </button>
        </span>
      </span>
    </div>
  );
}

function TdsLoading() {
  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="mpr-tdsload">
        <span className="spi-sk-bar mpr-tdsload__hd" />
        <div className="mpr-tdsload__grid">
          {Array.from({ length: 6 }, (_, i) => <span className="spi-sk-bar mpr-tdsload__cell" key={i} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ManagePaymentRequestsModal({ row, onClose }: { row: OrderRow; onClose: () => void }) {
  useScrollLock();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [tds, setTds] = useState(0);
  const [tdsOpen, setTdsOpen] = useState(false);

  const list = useMemo(() => buildRequests(row), [row]);

  const f = useMemo(() => {
    const requested = list.reduce((s, q) => s + q.amount, 0);
    const approved = list.reduce((s, q) => s + q.approved, 0);
    const paid = list.reduce((s, q) => s + q.paid, 0);
    const pendingAmt = list.filter((q) => q.status === 'pending').reduce((s, q) => s + q.amount, 0);
    const approvedUnpaid = list
      .filter((q) => q.status === 'approved')
      .reduce((s, q) => s + Math.max(0, q.approved - q.paid), 0);
    return {
      requested,
      approved,
      paid,
      pendingAmt,
      pendingCount: list.filter((q) => q.status === 'pending').length,
      approvedCount: list.filter((q) => q.status === 'approved').length,
      declinedCount: list.filter((q) => q.status === 'rejected').length,
      approvedUnpaid,
      readyCount: list.filter((q) => q.status === 'approved' && q.approved - q.paid > 0).length,
      openToRequest: Math.max(0, row.net - requested),
      complete: row.net > 0 && row.paid >= row.net,
    };
  }, [list, row]);

  const extra = 0;
  const base = Math.round((row.total - extra) / 1.18);
  const gst = row.total - extra - base;
  const pctPaid = row.net > 0 ? Math.round((row.paid / row.net) * 100) : 0;

  const spi = row.invoices[0];
  const canPay = f.approvedUnpaid > 0 && !row.cancelled;
  const canRequest = f.openToRequest > 0 && !row.cancelled && !f.complete;

  return createPortal(

    <div className="spi-mdl-backdrop">
      {tdsOpen && (
        <Suspense fallback={<TdsLoading />}>
          <DeductTdsModal
            po={row.po}
            base={base}
            gst={gst}
            extra={extra}
            total={row.total}
            room={row.balance}
            saved={tds}
            onSave={(amount) => { setTds(amount); setTdsOpen(false); }}
            onClose={() => setTdsOpen(false)}
          />
        </Suspense>
      )}

      <div className="spi-mdl mpr-card" role="dialog" aria-modal="true" aria-labelledby="mpr-title" tabIndex={-1} ref={cardRef}>

        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_HISTORY}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="mpr-title">Payment Requests History</span>
              <span className="mpr-hero__badge">
                <span className="mpr-hero__bdot" />
                {f.complete ? 'Payment Completed' : `${list.length} request${list.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className="mpr-hero__sub">All requests raised on this PO</div>
          </div>

          <div className="mpr-hero__chips">
            <Chip label="Supplier" value={row.supplier} meta={supplierCode(row.supplier)} mod="mpr-hero__chip--sup" />
            <Chip label="PO Number" value={row.po} meta={fmtDate(row.poDate)} />
            <Chip
              label={row.invoices.length > 1 ? 'SPI Numbers' : 'SPI Number'}
              value={spi ? spi.spi : '—'}
              meta={spi ? fmtDate(spi.spiDate) : undefined}
              extra={row.invoices.length > 1 ? <span className="mpr-hero__chip-meta">+{row.invoices.length - 1}</span> : undefined}
            />
            <Chip label="Shipment ID" value={row.shipment || '—'} meta={row.shipment ? fmtDate(row.shipmentDate) : undefined} />
            <Chip label="Opportunity ID" value={row.opportunity} meta={fmtDate(row.opportunityDate)} />
            <Chip label="Procurement ID" value={row.procurement} meta={fmtDate(row.procurementDate)} />
          </div>

          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          {f.complete && (
            <div className="mpr-done">
              <span className="mpr-done__ico">{ICON_CHECK}</span>
              <span>
                <b>Payment Completed</b> — the full net payable of {money(row.net)} has been released against this PO.
                No further requests can be raised.
              </span>
            </div>
          )}

          <Box
            label="Summary"
            title="PO Payment Details Summary"
            sub="How this PO’s value is made up and where it stands today · read-only"
            headerExtra={!row.cancelled && (
              <div className="mpr-tds" onClick={(e) => e.stopPropagation()}>
                {tds > 0 && (
                  <>
                    <span className="mpr-chip mpr-chip--cut" title={`Tax withheld at source on this PO · counted towards paid`}>
                      <span className="mpr-chip__ico">{ICON_TDS}</span>
                      <span className="mpr-chip__txt">
                        <span className="mpr-chip__k">TDS Deducted</span>
                        <b className="mpr-chip__v">{money(tds)}</b>
                      </span>
                    </span>
                    <span className="mpr-chip mpr-chip--net" title={`Payable to ${row.supplier} after TDS · ${money(row.total)} less ${money(tds)}`}>
                      <span className="mpr-chip__ico">{ICON_WALLET}</span>
                      <span className="mpr-chip__txt">
                        <span className="mpr-chip__k">Net Payable</span>
                        <b className="mpr-chip__v">{money(Math.max(0, row.total - tds))}</b>
                      </span>
                    </span>
                  </>
                )}
                <button
                  type="button"
                  className={`mpr-tdsbtn${tds > 0 ? ' mpr-tdsbtn--edit' : ''}`}
                  title={tds > 0 ? 'Revise the tax deducted at source on this PO' : 'Withhold tax at source against this PO'}
                  onClick={() => setTdsOpen(true)}
                >
                  <span className="mpr-tdsbtn__ico">{ICON_TDS}</span>
                  <span>{tds > 0 ? 'Revise TDS' : 'Deduct TDS Here'}</span>
                </button>
              </div>
            )}
          >
            <div className="mpr-stats">
              <Stat
                icon={<><rect x="2" y="7" width="20" height="14" rx="2.5" /><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" /></>}
                label="PO Base Amount (Without GST)" value={money(base)} sub="Pre-tax order value"
              />
              <Stat
                mod="mpr-stat--base"
                icon={<><path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" /></>}
                label="GST Amount" value={money(gst)} sub="18% on the base amount"
              />
              <Stat
                mod="mpr-stat--bal"
                icon={<><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>}
                label="Extra Charges" value={money(extra)} sub="None on this order"
              />
              <Stat
                mod="mpr-stat--gst"
                icon={<><circle cx="12" cy="12" r="10" /><path d="M12 7v10" /><path d="M9 10h6" /><path d="M9 14h6" /></>}
                label="Total PO Amount (Grand Total)" value={money(row.total)} sub={`${money(row.net)} net payable`}
              />
              <Stat
                mod="mpr-stat--paid"
                icon={<><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>}
                label="Total Paid Amount" value={money(row.paid)} sub={`${pctPaid}% of net payable released`}
              />
              <Stat
                mod="mpr-stat--tds"
                icon={<><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>}
                label="Balance Amount" value={money(row.balance)}
                sub={f.complete ? 'Fully settled' : 'Still to be released'}
              />
            </div>
          </Box>

          <Box
            label="Summary"
            title="All Request Details Summary"
            sub="Running totals as on today, across every request raised on this PO · click to hide"
          >
            <div className="mpr-stats">
              <Stat
                icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>}
                label="Total Requests" value={String(list.length)}
                sub={list.length
                  ? [f.approvedCount && `${f.approvedCount} approved`, f.pendingCount && `${f.pendingCount} awaiting`, f.declinedCount && `${f.declinedCount} declined`]
                    .filter(Boolean).join(' · ')
                  : 'None raised yet'}
              />
              <Stat
                mod="mpr-stat--base"
                icon={<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>}
                label="Total Requested Amount" value={money(f.requested)}
                sub={`${list.length} request${list.length === 1 ? '' : 's'} raised to date`}
              />
              <Stat
                mod="mpr-stat--bal"
                icon={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>}
                label="Awaiting For Approval" value={money(f.pendingAmt)}
                sub={`${f.pendingCount} with the approver now`}
              />
              <Stat
                mod="mpr-stat--gst"
                icon={<path d="M20 6 9 17l-5-5" />}
                label="Total Approved Amount" value={money(f.approved)}
                sub={`${money(f.approvedUnpaid)} awaiting release`}
              />
              <Stat
                mod="mpr-stat--paid"
                icon={<><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>}
                label="Total Paid Amount" value={money(f.paid)} sub={`${pctPaid}% of net payable released`}
              />
              <Stat
                mod="mpr-stat--tds"
                icon={<><path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" /></>}
                label="Balance Amount" value={money(f.openToRequest)}
                sub={f.complete ? 'PO settled in full' : 'Open to request'}
              />
            </div>
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">All Payment Requests</span>
              <span className="mpr-panel__c">{list.length}</span>
              <span className="mpr-panel__s">In the order they were raised</span>
            </div>

            {list.length === 0 ? (
              <div className="mpr-empty">
                <div className="mpr-empty__ico">{ICON_HISTORY}</div>
                <div className="mpr-empty__t">No payment requests yet</div>
                <div className="mpr-empty__s">
                  Requests raised from Request for PO Payment will appear here with their approval
                  decision and every payment released against them.
                </div>
              </div>
            ) : (
              <div className="mpr-table">
                <div className="mpr-row mpr-row--head">
                  <span className="mpr-c">Sr No</span>
                  <span className="mpr-c">Payment Request ID</span>
                  <span className="mpr-c">Payment Type</span>
                  <span className="mpr-c">Payment %</span>
                  <span className="mpr-c">Requested Payment Amount</span>
                  <span>Requested To</span>
                  <span className="mpr-c">Request Approval Status</span>
                  <span className="mpr-c">Approved Amount</span>
                  <span className="mpr-c">Paid Amount</span>
                  <span className="mpr-c">Action</span>
                </div>
                {list.map((q, i) => <RequestRow key={q.id} q={q} index={i} net={row.net} />)}
              </div>
            )}
          </div>
        </div>

        <div className="spi-mdl-foot">
          {canPay && (
            <div className="mpr-recap">
              <span className="mpr-recap__lbl">Ready To Pay</span>
              <b className="mpr-recap__val">{money(f.approvedUnpaid)}</b>
              <span className="mpr-recap__sep" />
              <span className="mpr-recap__type">across {f.readyCount} request{f.readyCount === 1 ? '' : 's'}</span>
            </div>
          )}
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
            {canRequest && <button type="button" className="spi-mdl-confirm mpr-raise">Raise New Request</button>}
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
