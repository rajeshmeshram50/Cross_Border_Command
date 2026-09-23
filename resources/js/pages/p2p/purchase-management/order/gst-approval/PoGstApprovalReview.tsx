// Full-page review of one PO senior-approval request, opened from the Inbox or
// the bell. Built around the one decision the senior makes: the left column
// says why the PO is here and what it is (only the facts that bear on the
// decision), the right column keeps the request and the Approve / Reject
// panel in view while the left scrolls.
// Loads GET /p2p/orders/gst-approvals/{id}; decides with PUT on the same URL.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../../../../contexts/ToastContext';
import { useConfirm } from '../../../../../contexts/ConfirmContext';
import { PoApiError, poApprovalApi, type GstApprovalRequest, type GstApprovalReview } from '../api/po-api';
import { PO_TYPE_LABEL, fmtDate, fmtDateTime, fmtMoney, initialsOf, monthsAgoText } from './approval-format';
import { formatProductCode } from '../../../../../utils/formatProductCode';
import './gst-approval.css';
import { formatProductCode } from '../../../../../utils/formatProductCode';

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

  // Also used after a decision, so the page shows what the server saved.
  // Keeps the current data on screen while it reloads (no flicker).
  const load = useCallback(async () => {
    const rid = Number(id);
    if (!rid) { setError('This link is not valid.'); return; }
    try {
      setData(await poApprovalApi.show(rid));
      setError('');
    } catch (e) {
      setData(null);
      if (e instanceof PoApiError && e.status === 404) {
        setError('This request no longer exists — the PO may have changed supplier or been deleted.');
      } else {
        // e.g. 403 "This request was not sent to you."
        setError(e instanceof PoApiError ? e.firstError : 'Could not load this request.');
      }
    }
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
    setActing(decision);
    try {
      await poApprovalApi.decide(data.request.id, { decision, reason: reason.trim() });
      const who = data.request.requested_by_name ?? 'The requester';
      toast.success(
        decision === 'approved' ? `${data.po.code} approved` : `${data.po.code} rejected`,
        decision === 'approved' ? `${who} can now submit it.` : `${who} has been told why.`,
      );
      setReason('');
      await load();
    } catch (e) {
      const err = e instanceof PoApiError ? e : null;
      if (err?.fieldErrors.reason) {
        setReasonErr(err.fieldErrors.reason[0]);
      } else {
        toast.error('Decision not saved', err?.firstError ?? 'Please try again.');
        // e.g. "already approved" / "PO was cancelled" — show the page as it is now.
        if (err?.status === 422) await load();
      }
    } finally {
      setActing(null);
    }
  };

  if (error) {
    return (
      <div className="pga-page">
        <div className="pga-empty">
          <i className="ri-error-warning-line" />
          <div className="pga-empty__t">{error}</div>
          <button type="button" className="pga-btn pga-btn--ghost" onClick={back}><i className="ri-arrow-left-line" /> Back to Inbox</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="pga-page"><div className="pga-loading"><span className="spinner-border spinner-border-sm" /> Loading request…</div></div>;
  }

  const { request: req, po, supplier, gst, lines } = data;
  const cur = po.currency_code;
  const months = gst?.stale_months ?? 3;
  // The server's own verdict, read live — never re-derived here, so the tags can't disagree with it.
  const scrutinyOk = !!gst && gst.gate !== 'blocked';
  const filingOk = gst?.gate === 'clear';
  const gstTotal = po.total_cgst + po.total_sgst + po.total_igst;
  const charges = po.shipping_charges + po.packaging_charges + po.other_charges;
  const closed = po.status === 'cancelled' || po.status === 'deleted';

  return (
    <div className="pga-page">
      <header className="pga-hero">
        <div className="pga-hero__l">
          <span className="pga-hero__ico"><i className="ri-file-shield-2-line" /></span>
          <div className="pga-hero__txt">
            <div className="pga-hero__row">
              <h1 className="pga-hero__t">PO Approval Request</h1>
              <span className="pga-hero__code">{po.code}</span>
              <StatusBadge status={req.status} />
            </div>
            <div className="pga-hero__s">
              <b>{req.requested_by_name ?? '—'}</b> asked <b>{req.requested_to_name ?? '—'}</b> on {fmtDateTime(req.requested_at)}
            </div>
          </div>
        </div>
        <button type="button" className="pga-hero__back" onClick={back}><i className="ri-arrow-left-line" /> Back to Inbox</button>
      </header>

      {closed && (
        <div className="pga-alert pga-alert--bad"><i className="ri-close-circle-line" /> This PO has been {po.status} — there is nothing left to decide.</div>
      )}
      {req.status === 'pending' && filingOk && (
        <div className="pga-alert pga-alert--ok"><i className="ri-checkbox-circle-line" /> The supplier’s GST has since been updated — this PO would now pass without approval.</div>
      )}

      <div className="pga-layout">
        <div className="pga-main">
          {/* 1 — why it is here */}
          <section className="pga-why">
            <div className="pga-why__head">
              <i className="ri-error-warning-line pga-why__ico" />
              <h2 className="pga-why__t">{req.status === 'pending' ? 'Why this needs your approval' : 'Why this needed approval'}</h2>
              <span className={`pga-status pga-status--${filingOk ? 'ok' : 'warn'}`}>{filingOk ? 'GST return current' : 'GST return overdue'}</span>
            </div>
            <div className="pga-why__body">
              <p className="pga-why__p">
                The supplier’s last GST return was filed <b>{monthsAgoText(gst?.filing_date)}</b>. A return older than {months} months
                blocks the PO from being submitted unless a senior approves it.
              </p>
              <div className="pga-facts pga-facts--split">
                <Fact k="Last GST filing" v={fmtDate(gst?.filing_date)} tag={<Tag tone={filingOk ? 'ok' : 'warn'}>{filingOk ? 'Current' : 'Overdue'}</Tag>} />
                <Fact k="GST scrutiny" v={fmtDate(gst?.scrutiny_date)} tag={<Tag tone={scrutinyOk ? 'ok' : 'bad'}>{scrutinyOk ? 'Current' : 'Expired'}</Tag>} />
                <Fact k="Supplier GSTIN" v={gst?.gstin ?? supplier?.gstin} mono />
              </div>
              {data.can_decide && (
                <div className="pga-why__foot">
                  <span><i className="ri-checkbox-circle-line pga-ok-ico" /> <b>Approve</b> — the PO can be submitted</span>
                  <span><i className="ri-close-circle-line pga-bad-ico" /> <b>Reject</b> — it stays blocked</span>
                </div>
              )}
            </div>
          </section>

          {/* 2 — what is being approved */}
          <section className="pga-card">
            <h3 className="pga-card__t"><i className="ri-file-list-3-line" /> Purchase order</h3>
            {/* Ruled cells: six facts of uneven length floated in white space and
                read as loose text rather than one record. */}
            <div className="pga-facts pga-facts--grid">
              <Fact k="Supplier" v={supplier?.name} sub={[supplier?.code, supplier?.risk && `${supplier.risk} risk`].filter(Boolean).join(' · ')} />
              <Fact k="PO date" v={fmtDate(po.po_date)} sub={po.po_type ? PO_TYPE_LABEL[po.po_type] ?? po.po_type : undefined} />
              <Fact k="Expected delivery" v={fmtDate(po.expected_delivery_date)} sub={[po.mode_of_transport, po.delivery_location].filter(Boolean).join(' · ')} />
              <Fact k="Payment" v={po.payment_type} />
              {po.link_type === 'with_shipment'
                ? <Fact k="Linked shipment" v={po.shipment_code} mono sub={[po.pi_code, po.customer_name].filter(Boolean).join(' · ')} />
                : <Fact k="Linked to" v="Standalone PO" sub="No shipment" />}
              <Fact k="Raised by" v={po.created_by_name} />
            </div>
          </section>

          {/* 3 — products */}
          <section className="pga-card">
            <h3 className="pga-card__t"><i className="ri-shopping-cart-2-line" /> Products <span className="pga-card__n">{lines.length}</span></h3>
            <div className="pga-tbl-wrap">
              <table className="pga-tbl">
                <thead>
                  <tr>
                    <th>#</th><th className="pga-l">Product</th><th>Qty</th><th>Rate</th><th>{data.tax_label === 'IGST' ? 'IGST' : 'GST'} %</th><th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && <tr><td colSpan={6} className="pga-l pga-muted">No product lines on this PO.</td></tr>}
                  {lines.map((l) => (
                    <tr key={l.line_no}>
                      <td>{l.line_no}</td>
                      <td className="pga-l">
                        <div className="pga-prod">{l.product_name ?? '—'}</div>
                        <div className="pga-prod-code">{[formatProductCode(l.product_code), l.hsn_code && `HSN ${l.hsn_code}`].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{l.quantity.toLocaleString('en-IN')}{l.uom ? ` ${l.uom}` : ''}</td>
                      <td>{fmtMoney(l.rate, cur)}</td>
                      <td>{l.gst_pct}%</td>
                      <td className="pga-strong">{fmtMoney(l.line_total, cur)}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals belong in the table, under the Total column they add up. */}
                {lines.length > 0 && (
                  <tfoot>
                    <tr className="pga-tot">
                      <td colSpan={5} className="pga-l">Products</td>
                      <td>{fmtMoney(po.taxable_total, cur)}</td>
                    </tr>
                    <tr className="pga-tot">
                      <td colSpan={5} className="pga-l">{data.tax_label}</td>
                      <td>{fmtMoney(gstTotal, cur)}</td>
                    </tr>
                    {charges > 0 && (
                      <tr className="pga-tot">
                        <td colSpan={5} className="pga-l">Charges</td>
                        <td>{fmtMoney(charges, cur)}</td>
                      </tr>
                    )}
                    <tr className="pga-tot pga-tot--grand">
                      <td colSpan={5} className="pga-l">Grand total</td>
                      <td>{fmtMoney(po.grand_total, cur)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </div>

        <aside className="pga-side">
          {/* The figure the decision is about, next to the decision itself: one
              number, then the parts it is made of. */}
          <section className="pga-amt">
            <span className="pga-amt__k">Amount to approve</span>
            <span className="pga-amt__v">{fmtMoney(po.grand_total, cur)}</span>
            <span className="pga-amt__s">{lines.length} product{lines.length === 1 ? '' : 's'} · {po.payment_type ?? 'Payment terms not set'}</span>
            {/* Only what the total is actually made of — a row of ₹0.00 is noise
                on the one panel that has to be read at a glance. */}
            {(gstTotal > 0 || charges > 0) && (
              <span className="pga-amt__rows">
                <span><i>Products</i><b>{fmtMoney(po.taxable_total, cur)}</b></span>
                {gstTotal > 0 && <span><i>{data.tax_label}</i><b>{fmtMoney(gstTotal, cur)}</b></span>}
                {charges > 0 && <span><i>Charges</i><b>{fmtMoney(charges, cur)}</b></span>}
              </span>
            )}
          </section>

          <section className="pga-card">
            <h3 className="pga-card__t"><i className="ri-chat-quote-line" /> Request</h3>
            <div className="pga-person">
              <span className="pga-person__av">{initialsOf(req.requested_by_name)}</span>
              <div className="pga-person__txt">
                <div className="pga-person__n">{req.requested_by_name ?? '—'}</div>
                <div className="pga-person__s">Sent {fmtDateTime(req.requested_at)}</div>
              </div>
            </div>
            <div className="pga-quote">{req.request_note || <span className="pga-muted">No note added.</span>}</div>
          </section>

          {data.can_decide ? (
            <section className="pga-card pga-decide">
              <h3 className="pga-card__t"><i className="ri-scales-3-line" /> Your decision</h3>
              <label className="pga-label" htmlFor="pga-reason">Reason <span className="pga-req">*</span></label>
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
          ) : req.status === 'pending' ? (
            <section className="pga-card pga-wait">
              <i className="ri-time-line" />
              <div>{closed ? 'No decision is needed any more.' : <>Waiting for <b>{req.requested_to_name ?? 'the approver'}</b> to decide.</>}</div>
            </section>
          ) : (
            <section className={`pga-card pga-outcome pga-outcome--${req.status === 'approved' ? 'ok' : 'bad'}`}>
              <div className="pga-outcome__head">
                <StatusBadge status={req.status} />
                <span className="pga-muted">by {req.requested_to_name ?? '—'} · {fmtDateTime(req.decided_at)}</span>
              </div>
              {req.reason && <div className="pga-outcome__reason">“{req.reason}”</div>}
            </section>
          )}

          {data.history.length > 1 && (
            <section className="pga-card">
              <h3 className="pga-card__t"><i className="ri-history-line" /> Earlier requests on this PO</h3>
              {data.history.filter((h) => h.id !== req.id).map((h) => <HistoryRow key={h.id} h={h} />)}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: GstApprovalRequest['status'] }) {
  const map = { pending: ['warn', 'ri-time-line', 'Pending'], approved: ['ok', 'ri-checkbox-circle-line', 'Approved'], rejected: ['bad', 'ri-close-circle-line', 'Rejected'] } as const;
  const [tone, icon, label] = map[status];
  return <span className={`pga-status pga-status--${tone}`}><i className={icon} /> {label}</span>;
}

function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <span className={`pga-tag pga-tag--${tone}`}>{children}</span>;
}

/** One labelled fact: value, an optional status tag beside it, an optional line under it. */
function Fact({ k, v, sub, tag, mono }: { k: string; v: ReactNode; sub?: string; tag?: ReactNode; mono?: boolean }) {
  const empty = v === null || v === undefined || v === '';
  return (
    <div className="pga-fact">
      <span className="pga-fact__k">{k}</span>
      <span className={`pga-fact__v${mono ? ' pga-mono' : ''}`}>{empty ? '—' : v}{tag}</span>
      {sub && <span className="pga-fact__s">{sub}</span>}
    </div>
  );
}

function HistoryRow({ h }: { h: GstApprovalRequest }) {
  return (
    <div className="pga-hist">
      <StatusBadge status={h.status} />
      <div className="pga-hist__b">
        <div><b>{h.requested_by_name ?? '—'}</b> → <b>{h.requested_to_name ?? '—'}</b> · {fmtDateTime(h.requested_at)}</div>
        {h.reason && <div className="pga-muted">“{h.reason}”</div>}
      </div>
    </div>
  );
}
