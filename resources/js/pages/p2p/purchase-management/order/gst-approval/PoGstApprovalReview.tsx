// Full-page review of one PO senior-approval request, opened from the Inbox or
// the bell. Shows the PO, supplier, GST position and lines; the chosen senior
// approves or rejects here, with a reason either way.
// UI ONLY for now — renders sampleReview(id) and saves nothing. To integrate:
// load with GET /p2p/orders/gst-approvals/{id}, decide with PUT /p2p/orders/gst-approvals/{id}.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../../../../contexts/ToastContext';
import { useConfirm } from '../../../../../contexts/ConfirmContext';
import type { GstApprovalRequest, GstApprovalReview } from '../api/po-api';
import { PO_TYPE_LABEL, fmtDate, fmtDateTime, fmtMoney, initialsOf, monthsSince } from './approval-format';
import { sampleReview } from './sample-data';
import './gst-approval.css';

const REASON_MAX = 1000;

export default function PoGstApprovalReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<GstApprovalReview | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState('');
  const [acting, setActing] = useState<'approved' | 'rejected' | null>(null);

  const load = useCallback(async () => {
    const sample = sampleReview(Number(id));
    setData(sample);
    setError(sample ? '' : 'This request no longer exists — the PO may have changed supplier or been deleted.');
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const back = () => { if (window.history.length > 1) navigate(-1); else navigate('/inbox'); };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!data) return;
    if (!reason.trim()) { setReasonErr(`Give a reason for ${decision === 'approved' ? 'approving' : 'rejecting'} this PO.`); return; }
    const ok = await confirm({
      title: decision === 'approved' ? 'Approve this purchase order?' : 'Reject this purchase order?',
      message: decision === 'approved'
        ? `${data.po.code} can then be submitted even though the supplier's GST return is overdue.`
        : `${data.po.code} stays blocked until the requester sends it again or the supplier's GST is updated.`,
      tone: decision === 'approved' ? 'success' : 'danger',
      confirmLabel: decision === 'approved' ? 'Approve' : 'Reject',
    });
    if (!ok) return;
    // Sample: the decision is shown on the page only — nothing is saved.
    setActing(decision);
    const now = new Date().toISOString();
    setData({ ...data, can_decide: false, request: { ...data.request, status: decision, reason: reason.trim(), decided_at: now } });
    toast.info(decision === 'approved' ? `${data.po.code} approved (sample)` : `${data.po.code} rejected (sample)`,
      'Sample screen — not saved yet.');
    setReason('');
    setActing(null);
  };

  if (error) {
    return (
      <div className="pga-page">
        <div className="pga-empty">
          <i className="ri-error-warning-line" />
          <div className="pga-empty__t">{error}</div>
          <button type="button" className="pga-btn pga-btn--ghost" onClick={back}><i className="ri-arrow-left-line" /> Back</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="pga-page"><div className="pga-loading"><span className="spinner-border spinner-border-sm" /> Loading request…</div></div>;
  }

  const { request: req, po, supplier, gst, lines } = data;
  const cur = po.currency_code;
  const inter = po.tax_mode === 'inter';
  const charges = po.shipping_charges + po.packaging_charges + po.other_charges;
  const scrutinyAge = monthsSince(gst?.scrutiny_date);
  const filingAge = monthsSince(gst?.filing_date);
  const months = gst?.stale_months ?? 3;
  const gstUpToDate = gst?.gate === 'clear';

  return (
    <div className="pga-page">
      {/* Header */}
      <div className="pga-head">
        <span className="pga-head__accent" />
        <div className="pga-head__l">
          <span className="pga-head__ico"><i className="ri-file-shield-2-line" /></span>
          <div className="min-w-0">
            <div className="pga-head__t">Senior Approval · {po.code}</div>
            <div className="pga-head__s">
              {req.requested_by_name ?? '—'} asked {req.requested_to_name ?? '—'} on {fmtDateTime(req.requested_at)} — the supplier’s GST return is overdue.
            </div>
          </div>
        </div>
        <div className="pga-head__r">
          <StatusBadge status={req.status} />
          <button type="button" className="pga-btn pga-btn--ghost" onClick={back}><i className="ri-arrow-left-line" /> Back</button>
        </div>
      </div>

      {(po.status === 'cancelled' || po.status === 'deleted') && (
        <div className="pga-alert pga-alert--bad"><i className="ri-close-circle-line" /> This PO has been {po.status} — there is nothing left to decide.</div>
      )}
      {req.status === 'pending' && gstUpToDate && (
        <div className="pga-alert pga-alert--ok"><i className="ri-checkbox-circle-line" /> The supplier’s GST has since been updated — this PO would now pass without approval.</div>
      )}

      {/* Summary strip */}
      <div className="pga-kpis">
        <Kpi label="Grand total" value={fmtMoney(po.grand_total, cur)} strong />
        <Kpi label="Supplier" value={supplier?.name ?? '—'} sub={supplier?.code ?? undefined} />
        <Kpi label="Last GST filing" value={fmtDate(gst?.filing_date)} sub={filingAge !== null ? `${filingAge} months ago` : 'Never filed'} tone="warn" />
        <Kpi label="Expected delivery" value={fmtDate(po.expected_delivery_date)} sub={po.mode_of_transport ?? undefined} />
      </div>

      <div className="pga-grid">
        {/* Request */}
        <section className="pga-card">
          <h3 className="pga-card__t"><i className="ri-mail-send-line" /> Request</h3>
          <div className="pga-person">
            <span className="pga-person__av">{initialsOf(req.requested_by_name)}</span>
            <div>
              <div className="pga-person__n">{req.requested_by_name ?? '—'}</div>
              <div className="pga-person__s">Raised {fmtDateTime(req.requested_at)}</div>
            </div>
          </div>
          <Kv k="Sent to" v={req.requested_to_name} />
          <Kv k="Status" v={<StatusBadge status={req.status} />} />
          {req.decided_at && <Kv k="Decided on" v={fmtDateTime(req.decided_at)} />}
          <div className="pga-quote">
            <span className="pga-quote__k">Note from requester</span>
            {req.request_note || <span className="pga-muted">No note added.</span>}
          </div>
          {req.reason && (
            <div className={`pga-quote pga-quote--${req.status === 'approved' ? 'ok' : 'bad'}`}>
              <span className="pga-quote__k">Reason given by {req.requested_to_name ?? 'the senior'}</span>
              {req.reason}
            </div>
          )}
        </section>

        {/* GST */}
        <section className="pga-card">
          <h3 className="pga-card__t"><i className="ri-shield-check-line" /> GST compliance</h3>
          <Kv k="GSTIN" v={gst?.gstin ?? supplier?.gstin} mono />
          <Kv k="Scrutiny date" v={<>{fmtDate(gst?.scrutiny_date)} <Tag tone={scrutinyAge !== null && scrutinyAge < months ? 'ok' : 'bad'}>{scrutinyAge !== null && scrutinyAge < months ? 'Current' : 'Expired'}</Tag></>} />
          <Kv k="Last GST filing" v={<>{fmtDate(gst?.filing_date)} <Tag tone={filingAge !== null && filingAge < months ? 'ok' : 'warn'}>{filingAge !== null ? `${filingAge} months ago` : 'None'}</Tag></>} />
          <Kv k="Allowed window" v={`${months} months`} />
          <div className="pga-note">
            Scrutiny is current, but the supplier has not filed a GST return inside the {months}-month window.
            Approving lets this PO be submitted anyway; rejecting keeps it blocked.
          </div>
        </section>

        {/* PO */}
        <section className="pga-card">
          <h3 className="pga-card__t"><i className="ri-file-list-3-line" /> Purchase order</h3>
          <Kv k="PO number" v={po.code} mono />
          <Kv k="PO date" v={fmtDate(po.po_date)} />
          <Kv k="Raised by" v={po.created_by_name} />
          <Kv k="PO type" v={po.po_type ? PO_TYPE_LABEL[po.po_type] ?? po.po_type : null} />
          <Kv k="Document type" v={po.document_type === 'international' ? 'International' : po.document_type === 'domestic' ? 'Domestic' : null} />
          <Kv k="Linked to" v={po.link_type === 'with_shipment' ? 'Shipment' : 'Standalone (no shipment)'} />
          {po.link_type === 'with_shipment' && (
            <>
              <Kv k="Shipment" v={po.shipment_code} mono />
              <Kv k="PI number" v={po.pi_code} mono />
              <Kv k="Opportunity" v={po.opportunity_code} mono />
              <Kv k="Customer" v={po.customer_name} />
            </>
          )}
          <Kv k="Payment type" v={po.payment_type} />
          <Kv k="Delivery location" v={po.delivery_location} />
          {po.document_type === 'international' && (
            <>
              <Kv k="Currency" v={cur ? `${cur}${po.exchange_rate ? ` @ ${po.exchange_rate}` : ''}` : null} />
              <Kv k="Inco term" v={po.inco_term} />
              <Kv k="Port of loading" v={po.port_of_loading} />
              <Kv k="Port of discharge" v={po.port_of_discharge} />
            </>
          )}
          <Kv k="Physical inspection" v={po.physical_inspection === 'yes' ? 'Required' : 'Not required'} />
        </section>

        {/* Supplier */}
        <section className="pga-card">
          <h3 className="pga-card__t"><i className="ri-store-2-line" /> Supplier</h3>
          <Kv k="Supplier code" v={supplier?.code} mono />
          <Kv k="Legal name" v={supplier?.name} />
          <Kv k="GSTIN" v={supplier?.gstin} mono />
          <Kv k="State code" v={supplier?.state_code} />
          <Kv k="Tax" v={inter ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST'} />
          <Kv k="Risk level" v={supplier?.risk} />
          <Kv k="Category" v={supplier?.category} />
        </section>
      </div>

      {/* Lines */}
      <section className="pga-card pga-card--wide">
        <h3 className="pga-card__t"><i className="ri-shopping-cart-2-line" /> Products <span className="pga-card__n">{lines.length}</span></h3>
        <div className="pga-tbl-wrap">
          <table className="pga-tbl">
            <thead>
              <tr>
                <th>#</th><th className="pga-l">Product</th><th>HSN</th><th>Qty</th><th>Rate</th>
                <th>{inter ? 'IGST' : 'GST'} %</th><th>Product cost</th><th>GST amount</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && <tr><td colSpan={9} className="pga-muted">No product lines on this PO.</td></tr>}
              {lines.map((l) => (
                <tr key={l.line_no}>
                  <td>{l.line_no}</td>
                  <td className="pga-l">
                    <div className="pga-prod">{l.product_name ?? '—'}</div>
                    {l.product_code && <div className="pga-prod-code">{l.product_code}</div>}
                  </td>
                  <td>{l.hsn_code ?? '—'}</td>
                  <td>{l.quantity.toLocaleString('en-IN')}{l.uom ? ` ${l.uom}` : ''}</td>
                  <td>{fmtMoney(l.rate, cur)}</td>
                  <td>{l.gst_pct}%</td>
                  <td>{fmtMoney(l.taxable_amount, cur)}</td>
                  <td>{fmtMoney(l.gst_amount, cur)}</td>
                  <td className="pga-strong">{fmtMoney(l.line_total, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pga-totals">
          <Kv k="Product cost (without GST)" v={fmtMoney(po.taxable_total, cur)} />
          {inter
            ? <Kv k="IGST" v={fmtMoney(po.total_igst, cur)} />
            : <><Kv k="CGST" v={fmtMoney(po.total_cgst, cur)} /><Kv k="SGST" v={fmtMoney(po.total_sgst, cur)} /></>}
          <Kv k="Charges (shipping, packaging, other)" v={fmtMoney(charges, cur)} />
          <div className="pga-grand"><span>Grand total</span><span>{fmtMoney(po.grand_total, cur)}</span></div>
        </div>
      </section>

      {/* Earlier requests on the same PO */}
      {data.history.length > 1 && (
        <section className="pga-card pga-card--wide">
          <h3 className="pga-card__t"><i className="ri-history-line" /> All requests on this PO</h3>
          {data.history.map((h) => <HistoryRow key={h.id} h={h} current={h.id === req.id} />)}
        </section>
      )}

      {/* Decision */}
      {data.can_decide && (
        <section className="pga-card pga-card--wide pga-decide">
          <h3 className="pga-card__t"><i className="ri-scales-3-line" /> Your decision</h3>
          <label className="pga-label" htmlFor="pga-reason">Reason <span className="pga-req">*</span> <span className="pga-hint">required to approve or reject</span></label>
          <textarea
            id="pga-reason"
            className={`pga-ta${reasonErr ? ' is-invalid' : ''}`}
            maxLength={REASON_MAX}
            placeholder="e.g. Supplier confirmed the return will be filed this week — one-time approval."
            value={reason}
            onChange={(e) => { setReason(e.target.value); setReasonErr(''); }}
          />
          <div className="pga-ta-foot">
            <span className="pga-err">{reasonErr}</span>
            <span className="pga-counter">{reason.length} / {REASON_MAX}</span>
          </div>
          <div className="pga-actions">
            <button type="button" className="pga-btn pga-btn--reject" disabled={!!acting} onClick={() => decide('rejected')}>
              {acting === 'rejected' ? <><i className="ri-loader-4-line ri-spin" /> Rejecting…</> : <><i className="ri-close-line" /> Reject</>}
            </button>
            <button type="button" className="pga-btn pga-btn--approve" disabled={!!acting} onClick={() => decide('approved')}>
              {acting === 'approved' ? <><i className="ri-loader-4-line ri-spin" /> Approving…</> : <><i className="ri-check-line" /> Approve</>}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: GstApprovalRequest['status'] }) {
  const map = { pending: ['warn', 'ri-time-line', 'Pending'], approved: ['ok', 'ri-checkbox-circle-line', 'Approved'], rejected: ['bad', 'ri-close-circle-line', 'Rejected'] } as const;
  const [tone, icon, label] = map[status];
  return <span className={`pga-status pga-status--${tone}`}><i className={icon} /> {label}</span>;
}

function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }) {
  return <span className={`pga-tag pga-tag--${tone}`}>{children}</span>;
}

function Kv({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="pga-kv">
      <span className="pga-kv__k">{k}</span>
      <span className={`pga-kv__v${mono ? ' pga-mono' : ''}`}>{v === null || v === undefined || v === '' ? '—' : v}</span>
    </div>
  );
}

function Kpi({ label, value, sub, strong, tone }: { label: string; value: string; sub?: string; strong?: boolean; tone?: 'warn' }) {
  return (
    <div className={`pga-kpi${strong ? ' pga-kpi--strong' : ''}${tone ? ` pga-kpi--${tone}` : ''}`}>
      <span className="pga-kpi__k">{label}</span>
      <span className="pga-kpi__v" title={value}>{value}</span>
      {sub && <span className="pga-kpi__s">{sub}</span>}
    </div>
  );
}

function HistoryRow({ h, current }: { h: GstApprovalRequest; current: boolean }) {
  return (
    <div className={`pga-hist${current ? ' is-current' : ''}`}>
      <StatusBadge status={h.status} />
      <div className="pga-hist__b">
        <div><b>{h.requested_by_name ?? '—'}</b> → <b>{h.requested_to_name ?? '—'}</b> · {fmtDateTime(h.requested_at)}{current ? ' · this request' : ''}</div>
        {h.reason && <div className="pga-muted">“{h.reason}” — {fmtDateTime(h.decided_at)}</div>}
      </div>
    </div>
  );
}
