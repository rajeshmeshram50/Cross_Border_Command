// Reason For Decline — read-only record of a declined payment request.
// Shell, header and footer come from the Bulk Sourcing modal styles (srpt-* / pl-*).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalGuard } from '../../procurement-management/bulk-sourcing/useModalGuard';
import { IcoBan, IcoChevron, IcoX } from '../../icons';
import { Chip } from '../../purchase-management/order/manage-payment/payment-shared';
import { STATUS_LABEL, type PaymentRequestRow } from './paymentRequestData';
import '../../p2p-common.css';
import '../../procurement-management/bulk-sourcing/bulk-sourcing.css';
import '../../purchase-management/order/manage-payment/manage-payment-requests.css';
import './payment-request.css';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtMoney = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`prm-dc-field${wide ? ' prm-dc-field--wide' : ''}`}>
      <span className="prm-dc-label">{label}</span>
      <div className="prm-dc-value">{children}</div>
    </div>
  );
}

export default function DeclineReasonModal({ row, onClose }: { row: PaymentRequestRow; onClose: () => void }) {
  const { pulse, guardOverlay } = useModalGuard();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  const dec = row.decline;
  const doc = row.spi ?? row.po;

  return createPortal(
    <div id="srpt-overlay" onMouseDown={guardOverlay}>
      <div className={`srpt-box prm-dc-box${pulse ? ' bsm-pulse' : ''}`} role="dialog" aria-modal="true" aria-label={`Reason for decline, ${row.requestId}`}>

        <div className="srpt-header">
          <div className="srpt-hrow">
            <div className="srpt-title-wrap">
              <div className="srpt-hicon"><IcoBan size={20} stroke={2.1} /></div>
              <div className="srpt-title-block">
                <div className="srpt-title-line">
                  <h3 className="srpt-title">Reason For Decline</h3>
                  <span className="srpt-id-pill">{row.requestId}</span>
                  <span className="srpt-badge prm-dc-badge"><span className="srpt-bdot" />{STATUS_LABEL.declined}</span>
                </div>
                <p className="srpt-sub">Decision recorded on this request · read-only</p>
              </div>
            </div>

            <div className="mpr-hero__chips prm-dc-meta">
              <Chip label={row.spi ? 'SPI Number' : 'PO Number'} value={doc?.id ?? '—'} />
              {row.spi && row.po && <Chip label="Against PO" value={row.po.id} />}
              <Chip label="Supplier" value={row.supplier} />
              <Chip label="Requested By" value={row.requestedBy.name} />
              <button className="srpt-close" onClick={onClose} aria-label="Close"><IcoX size={13} stroke={2.8} /></button>
            </div>
          </div>
        </div>

        <div className="srpt-body prm-dc-body">
          {/* Same header as the page's "What We Are Doing Here" strip (spi-bref-*). */}
          <div className={`spi-bref prm-dc-panel${open ? '' : ' is-collapsed'}`}>
            <div
              className="spi-bref-head"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={() => setOpen(v => !v)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v); } }}
            >
              <div className="spi-bref-ico"><IcoBan size={14} stroke={2.4} /></div>
              <div className="spi-bref-mid">
                <div className="spi-bref-row">
                  <div className="spi-bref-label">Decline</div>
                  <div className="spi-bref-sep" />
                  <div className="spi-bref-title">Request Details &amp; Reason</div>
                </div>
                <div className="spi-bref-sub">Exactly as raised, and the decision taken on it · read-only</div>
              </div>
              <div className="spi-bref-toggle"><IcoChevron size={10} stroke={2.8} /></div>
            </div>

            {open && <div className="prm-dc-grid">
              <Field label="Request ID"><span className="prm-dc-strong">{row.requestId}</span></Field>
              <Field label="Requested Date">{fmtDate(row.requestDate)}</Field>
              <Field label="Payment Type">{row.paymentType}</Field>
              <Field label="Payment Percentage">{row.percentOfTotal}%</Field>
              <Field label="Requested Payment Amount"><span className="prm-dc-strong">{fmtMoney(row.requestedAmount)}</span></Field>
              <Field label="Declined On">{dec ? fmtDate(dec.on) : '—'}</Field>
              <Field label="Declined By">
                <span className="prm-dc-person" title={dec?.by.name ?? ''}>{dec?.by.name ?? '—'}</span>
                {dec?.by.role && <span className="prm-dc-person__role">{dec.by.role}</span>}
              </Field>
              <Field label="Rejection Reason" wide>
                <div className="prm-dc-reason">{dec?.reason ?? 'No reason recorded.'}</div>
              </Field>
            </div>}
          </div>
        </div>

        <div className="pl-foot prm-dc-foot">
          <span className="prm-dc-foot__note">
            <span className="prm-dc-foot__k">Declined</span>
            <b>{fmtMoney(row.requestedAmount)}</b>
            <span className="prm-dc-foot__sep">|</span>
            returned to the available balance
          </span>
          <button type="button" className="prm-dc-close" onClick={onClose}>Close</button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
