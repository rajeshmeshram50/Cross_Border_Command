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
import { PoApiError, poApprovalApi, poLookupApi, type GstApprovalRequest, type GstApprovalReview } from '../api/po-api';
import { cutoffDate, legalFromVault, monthsAgo, type LegalView } from '../create-po/supplier-checks';
import { PO_TYPE_LABEL, fmtDate, fmtDateTime, fmtMoney, initialsOf, monthsAgoText } from './approval-format';
import { formatProductCode } from '../../../../../utils/formatProductCode';
// The header strip is the payment-request review's, class for class.
import '../../../payment-management/payment-request/payment-request-detail.css';
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
  /* How much of the supplier's one-time paperwork is verified, read from its
     own Evidence Vault — the same reading the Create PO form gates on, so the
     two screens can never disagree about what is complete. */
  const [legal, setLegal] = useState<LegalView | null>(null);
  const [legalFailed, setLegalFailed] = useState(false);

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

  const vendorId = data?.supplier?.id;
  useEffect(() => {
    if (!vendorId) return;
    let alive = true;
    poLookupApi.supplierVault(vendorId)
      .then((vault) => { if (alive) setLegal(legalFromVault(vault)); })
      .catch(() => { if (alive) setLegalFailed(true); });
    return () => { alive = false; };
  }, [vendorId]);

  const back = () => { if (window.history.length > 1) navigate(-1); else navigate('/inbox'); };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!data) return;
    if (!reason.trim()) {
      setReasonErr(`Give a reason for ${decision === 'approved' ? 'approving' : 'rejecting'} this PO.`);
      // The buttons sit in the header now, far from the box that is missing.
      const box = document.getElementById('pga-reason');
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box?.focus({ preventScroll: true });
      return;
    }
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
  if (!data) return <PgaSkeleton />;

  const { request: req, po, supplier, gst, lines } = data;
  const cur = po.currency_code;
  const months = gst?.stale_months ?? 3;
  // The server's own verdict, read live — never re-derived here, so the tags can't disagree with it.
  const scrutinyOk = !!gst && gst.gate !== 'blocked';
  const filingOk = gst?.gate === 'clear';
  const gstTotal = po.total_cgst + po.total_sgst + po.total_igst;
  const charges = po.shipping_charges + po.packaging_charges + po.other_charges;
  const closed = po.status === 'cancelled' || po.status === 'deleted';
  // The age of the return, read the way the requester's own notice read it.
  const filingAge = gst?.filing_date ? monthsAgo(gst.filing_date) : null;
  const gate = gst?.gate ?? 'clear';
  const risk = (supplier?.risk ?? '').toLowerCase();
  const riskTone = risk.includes('critical') || risk.includes('high') ? 'bad' : risk.includes('medium') ? 'warn' : 'ok';
  const inactive = (supplier?.status ?? '').toLowerCase() === 'inactive';
  /** One stat tile in the two summary panels under the header. */
  const card = (icon: string, label: string, value: string, cls = '') => (
    <div className="prd-refcard" key={label}>
      <div className="prd-refcard__lbl"><i className={icon} /> {label}</div>
      <div className={`prd-refcard__val ${cls}`} title={value}>{value}</div>
    </div>
  );
  /** One reference tile in the header strip — the payment-request shape. */
  const chip = (icon: string, label: string, value: string, sub: string) => (
    <div className="prd-chip" key={label}>
      <div className="prd-chip__lbl"><i className={icon} /> {label}</div>
      <div className="prd-chip__val" title={value}>{value}</div>
      <div className="prd-chip__sub" title={sub}>{sub}</div>
    </div>
  );

  return (
    <div className="pga-page">
      {/* The payment-request review's own header, reused rather than copied:
          the request and its badge on the left, every reference this PO is
          attached to across the middle, and the decision beside the way out.
          No Evidence Vault here — a GST approval is decided on the PO's own
          facts, which the page below already lays out. */}
      <header className="prd-head pga-head">
        <div className="prd-hrow">
          <div className="prd-titlewrap">
            <div className="prd-hicon"><i className="ri-file-shield-2-line" /></div>
            <div className="prd-titleblock">
              <div className="prd-titleline">
                <h3 className="prd-title">{po.code}</h3>
                <span className={`prd-badge ${req.status === 'approved' ? 'done' : req.status === 'rejected' ? 'no' : 'prog'}`}>
                  <span className="prd-badge__dot" />
                  {req.status === 'approved' ? 'Approved' : req.status === 'rejected' ? 'Rejected' : 'Pending'}
                </span>
              </div>
              <p className="prd-sub">
                GST approval requested by <b className="prd-sub__doc">{req.requested_by_name ?? '—'}</b> · {fmtDateTime(req.requested_at)}
              </p>
            </div>
          </div>

          <div className="prd-right">
            {/* The full reference row, as the payment-request review carries it:
                every id this PO is attached to, in the same order, shown even
                when empty so the strip reads the same on every request. */}
            <div className="prd-chips">
              {chip('ri-file-list-3-line', 'PO Number', po.code, fmtDate(po.po_date))}
              {chip('ri-building-line', 'Supplier', supplier?.code ?? '—', supplier?.name ?? '')}
              {chip('ri-ship-line', 'Shipment ID', po.shipment_code ?? '—', '')}
              {chip('ri-focus-3-line', 'Opportunity ID', po.opportunity_code ?? '—', '')}
              {chip('ri-bill-line', 'PI Number', po.pi_code ?? '—', po.customer_name ?? '')}
            </div>
            <div className="prd-hactions">
              <button
                type="button"
                className="prd-act prd-act--ok"
                disabled={!data.can_decide || !!acting || closed}
                title={data.can_decide ? 'Approve — the PO can be submitted' : 'Only the senior this was sent to can decide it'}
                onClick={() => decide('approved')}
              >
                <i className="ri-check-line" />
                {acting === 'approved' ? 'Approving…' : 'Approve Request'}
              </button>
              <button
                type="button"
                className="prd-act prd-act--no"
                disabled={!data.can_decide || !!acting || closed}
                title={data.can_decide ? 'Reject — the PO stays blocked' : 'Only the senior this was sent to can decide it'}
                onClick={() => decide('rejected')}
              >
                <i className="ri-close-circle-line" />
                {acting === 'rejected' ? 'Rejecting…' : 'Reject / Decline Request'}
              </button>
              <button type="button" className="prd-close" title="Back to Inbox" onClick={back}><i className="ri-arrow-left-line" /></button>
            </div>
          </div>
        </div>

        {/* What the PO is worth. The request's own details — who asked, of
            whom, when, and its status — are the title row and the subtitle
            right above; repeating them as five tiles said nothing twice. */}
        <div className="prd-cols prd-cols--one">
          <div className="prd-col">
            <div className="prd-col__hd">
              <div className="prd-col__ico"><i className="ri-wallet-3-line" /></div>
              <span className="prd-col__t">Purchase Order Value</span><span className="prd-col__rule" />
            </div>
            <div className="prd-col__grid">
              {/* A row of ₹0.00 is noise: tax and charges appear only when the
                  PO actually carries them. */}
              {card('ri-shopping-cart-2-line', 'Products', `${lines.length}`)}
              {card('ri-money-rupee-circle-line', 'Taxable Amount', fmtMoney(po.taxable_total, cur), 'is-amt')}
              {gstTotal > 0 && card('ri-government-line', data.tax_label, fmtMoney(gstTotal, cur), 'is-amt')}
              {charges > 0 && card('ri-truck-line', 'Charges', fmtMoney(charges, cur), 'amber is-amt')}
              {card('ri-bill-line', 'Grand Total', fmtMoney(po.grand_total, cur), 'green is-amt')}
            </div>
          </div>
        </div>
      </header>

      {closed && (
        <div className="pga-alert pga-alert--bad"><i className="ri-close-circle-line" /> This PO has been {po.status} — there is nothing left to decide.</div>
      )}
      {/* The "GST has since been updated" banner is gone: the same fact is
          already on the card's own GST return current badge and in the GST
          Position tile, and as a full-width green strip it read like the
          decision had been made. */}

      <div className="pga-layout">
        <div className="pga-main">
          {/* 0 — the three readings the decision turns on, before any prose:
              how the supplier is rated, where its GST stands, and how much of
              its paperwork is actually verified. The amount is not repeated
              here — it holds the top of the rail. */}
          <div className="pga-tiles">
            <div className={`pga-tile pga-tile--${riskTone}`}>
              <span className="pga-tile__ico"><i className="ri-alert-line" /></span>
              <div className="pga-tile__txt">
                <div className="pga-tile__lbl">Risk Level</div>
                <div className="pga-tile__val">{supplier?.risk ?? 'Not rated'}</div>
                <div className="pga-tile__sub">{[supplier?.category, inactive ? 'Inactive in the master' : null].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            </div>

            <div className={`pga-tile pga-tile--${gate === 'clear' ? 'ok' : gate === 'blocked' ? 'bad' : 'warn'}`}>
              <span className="pga-tile__ico"><i className="ri-government-line" /></span>
              <div className="pga-tile__txt">
                <div className="pga-tile__lbl">
                  GST Position
                  <Tag tone={gate === 'clear' ? 'ok' : gate === 'blocked' ? 'bad' : 'warn'}>
                    {gate === 'clear' ? 'Clear' : gate === 'blocked' ? 'Scrutiny expired' : 'Approval required'}
                  </Tag>
                </div>
                <div className="pga-tile__val pga-tile__val--mono">{gst?.gstin ?? supplier?.gstin ?? '—'}</div>
                <div className="pga-tile__sub">
                  GST applicable {(supplier?.gst_applicable ?? 'yes').toString().toLowerCase() === 'no' ? 'No' : 'Yes'}
                  {filingAge != null ? ` · return filed ${filingAge.toFixed(1)} months ago` : ''}
                </div>
              </div>
            </div>

            <div className={`pga-tile pga-tile--${legal ? (legal.pct === 100 ? 'ok' : legal.pct >= 50 ? 'warn' : 'bad') : 'ok'}`}>
              <span className="pga-tile__ico"><i className="ri-shield-check-line" /></span>
              <div className="pga-tile__txt">
                <div className="pga-tile__lbl">Legal Verification</div>
                {legalFailed ? (
                  <div className="pga-tile__val pga-tile__val--sm">Vault unavailable</div>
                ) : !legal ? (
                  <div className="pga-tile__val pga-tile__val--sm">Reading…</div>
                ) : (
                  <>
                    <div className="pga-tile__val">{legal.pct}% Verified</div>
                    <div className="pga-tile__rows">
                      {legal.sections.map((s) => (
                        <span key={s.name}><b>{s.done} / {s.total}</b>{s.name === 'Standard Documents' ? 'Documents' : 'Case to Case'}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {legal && <Donut pct={legal.pct} />}
            </div>
          </div>

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
              {/* The same four readings the requester was shown when the check
                  stopped them — including the date the return had to be on or
                  after, which is the rule itself. */}
              <div className="pga-facts pga-facts--split">
                <Fact k="Last GST filing" v={fmtDate(gst?.filing_date)}
                  tag={<Tag tone={filingOk ? 'ok' : 'warn'}>{filingAge != null ? `${filingAge.toFixed(1)} months ago` : filingOk ? 'Current' : 'Overdue'}</Tag>} />
                <Fact k="GST scrutiny" v={fmtDate(gst?.scrutiny_date)} tag={<Tag tone={scrutinyOk ? 'ok' : 'bad'}>{scrutinyOk ? 'Current' : 'Expired'}</Tag>} />
                <Fact k="Required on or after" v={fmtDate(cutoffDate())} sub={`${months} months before today`} />
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

          {/* 2 & 3 side by side: who is being bought from, and what is being
              bought. Stacked, each card ran the full width for six short facts
              and left a column of white space down the middle. */}
          <div className="pga-duo">
            <SupplierPanel supplier={supplier} gst={gst} riskTone={riskTone} inactive={inactive} />

            <section className="pga-card">
              <h3 className="pga-card__t"><i className="ri-file-list-3-line" /> Purchase order</h3>
              {/* Ruled cells: six facts of uneven length floated in white space and
                  read as loose text rather than one record. */}
              <div className="pga-facts pga-facts--grid">
                <Fact k="PO date" v={fmtDate(po.po_date)} sub={po.po_type ? PO_TYPE_LABEL[po.po_type] ?? po.po_type : undefined} />
                <Fact k="Expected delivery" v={fmtDate(po.expected_delivery_date)} sub={[po.mode_of_transport, po.delivery_location].filter(Boolean).join(' · ')} />
                <Fact k="Payment" v={po.payment_type} />
                {po.link_type === 'with_shipment'
                  ? <Fact k="Linked shipment" v={po.shipment_code} mono sub={[po.pi_code, po.customer_name].filter(Boolean).join(' · ')} />
                  : <Fact k="Linked to" v="Standalone PO" sub="No shipment" />}
                <Fact k="Raised by" v={po.created_by_name} />
                <Fact k="Document type" v={po.document_type === 'international' ? 'International' : 'Domestic'} sub={po.currency_code ?? undefined} />
              </div>
            </section>
          </div>

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
                {/* No totals row: the header strip carries Products, Taxable
                    Amount and Grand Total, and the PO amount panel repeats the
                    figure beside the decision. Three more rows here only made
                    the card taller. */}
              </table>
            </div>
          </section>
        </div>

        <aside className="pga-side">
          {/* The figure the decision is about, next to the decision itself: one
              number, then the parts it is made of. */}
          <section className="pga-amt">
            {/* What it is: the PO's own total. Nothing is paid by this
                decision — the senior is allowing the PO to be submitted — so
                "amount to approve" read as a payment approval. */}
            <span className="pga-amt__k">PO amount</span>
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

          {/* The decision comes before the request note: on a laptop screen the
              approver landed with Reject / Approve below the fold and had to
              scroll to find them. What they came to do is now in view, and the
              note that explains it reads underneath. */}
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
              {/* The decision itself is taken in the header, where it sits on
                  every P2P request screen. Two pairs of Approve / Reject on one
                  page only asked which one counted. */}
              <div className="pga-decide__hint">
                <i className="ri-arrow-up-line" />
                {/* One span: loose text beside the icon becomes its own flex
                    item per run, which broke the sentence into columns. */}
                <span>Write the reason, then use <b>Approve Request</b> or <b>Reject / Decline Request</b> at the top.</span>
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

/* The supplier, as the approver needs to see it: identity, the risk rating the
   master carries, where the GST stands today, and how much of the one-time
   paperwork is verified. The legal figures come from the supplier's own
   Evidence Vault — the same reading the Create PO form gates on — so the two
   screens can never disagree about what is complete. */
function SupplierPanel({ supplier, gst, riskTone, inactive }: {
  supplier: GstApprovalReview['supplier'];
  gst: GstApprovalReview['gst'];
  riskTone: 'ok' | 'warn' | 'bad';
  inactive: boolean;
}) {
  if (!supplier) return null;

  return (
    <section className="pga-card pga-sup">
      <h3 className="pga-card__t">
        <i className="ri-building-line" /> Supplier
        <span className="pga-sup__code">{supplier.code ?? '—'}</span>
        <span className="pga-sup__spacer" />
        {supplier.risk && <span className={`pga-tag pga-tag--${riskTone}`}>{supplier.risk} risk</span>}
        {inactive && <span className="pga-tag pga-tag--bad">Inactive</span>}
      </h3>

      {(riskTone === 'bad' || inactive) && (
        <div className="pga-alert pga-alert--bad pga-sup__alert">
          <i className="ri-alert-line" />
          {/* One span: beside a flex icon each run of loose text becomes its
              own flex item, which broke the sentence into columns. */}
          {/* Short enough for one line: the tags above already say Critical
              and Inactive, so the note only has to say what to do about it. */}
          <span>
            {inactive
              ? <><b>Inactive</b> in the master{riskTone === 'bad' ? <> · rated <b>{supplier.risk}</b></> : null} — check before approving.</>
              : <>Rated <b>{supplier.risk}</b> — approve only if the order must go to them.</>}
          </span>
        </div>
      )}

      <div className="pga-facts pga-facts--grid">
        <Fact k="Legal name" v={supplier.name} sub={supplier.company_name !== supplier.name ? supplier.company_name ?? undefined : undefined} />
        <Fact k="Supplier type" v={supplier.type} sub={supplier.category ?? undefined} />
        <Fact k="GSTIN" v={supplier.gstin ?? gst?.gstin} mono />
        <Fact k="State" v={[supplier.state, supplier.state_code && `Code ${supplier.state_code}`].filter(Boolean).join(' · ')} sub={supplier.city ?? undefined} />
        <Fact k="Contact" v={supplier.contact_name} sub={[supplier.contact_no, supplier.email].filter(Boolean).join(' · ')} />
        <Fact k="Address" v={supplier.address} />
      </div>

    </section>
  );
}

/* The page while it loads: the shape it is about to take, so the wait reads as
   the page arriving rather than a spinner in an empty white box. Opened from a
   notification, this is the approver's first impression of the request. */
function PgaSkeleton() {
  return (
    <div className="pga-page pga-skel" aria-busy="true" aria-label="Loading the request">
      <header className="prd-head pga-head">
        <div className="prd-hrow">
          <div className="prd-titlewrap">
            <div className="prd-hicon" />
            <div className="prd-titleblock">
              <span className="pga-sk pga-sk--title" />
              <span className="pga-sk pga-sk--sub" />
            </div>
          </div>
          <div className="prd-right">
            <div className="prd-chips">
              {[0, 1, 2, 3, 4].map((i) => <div className="prd-chip" key={i}><span className="pga-sk pga-sk--chip" /></div>)}
            </div>
            <div className="prd-hactions">
              <span className="pga-sk pga-sk--btn" />
              <span className="pga-sk pga-sk--btn pga-sk--btn-wide" />
            </div>
          </div>
        </div>
        <div className="prd-cols prd-cols--one">
          <div className="prd-col">
            <span className="pga-sk pga-sk--label" />
            <div className="prd-col__grid">
              {[0, 1, 2].map((i) => <div className="prd-refcard" key={i}><span className="pga-sk pga-sk--tile" /></div>)}
            </div>
          </div>
        </div>
      </header>

      <div className="pga-tiles">
        {[0, 1, 2].map((i) => (
          <div className="pga-tile" key={i}>
            <span className="pga-sk pga-sk--ico" />
            <div className="pga-tile__txt">
              <span className="pga-sk pga-sk--label" />
              <span className="pga-sk pga-sk--value" />
              <span className="pga-sk pga-sk--sub" />
            </div>
          </div>
        ))}
      </div>

      <div className="pga-layout">
        <div className="pga-main">
          <section className="pga-card">
            <span className="pga-sk pga-sk--head" />
            <div className="pga-facts pga-facts--grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div className="pga-fact" key={i}>
                  <span className="pga-sk pga-sk--label" />
                  <span className="pga-sk pga-sk--value" />
                </div>
              ))}
            </div>
          </section>
          <section className="pga-card">
            <span className="pga-sk pga-sk--head" />
            {[0, 1, 2].map((i) => <span className="pga-sk pga-sk--row" key={i} />)}
          </section>
        </div>
        <aside className="pga-side">
          <div className="pga-sk pga-sk--amt" />
          <section className="pga-card">
            <span className="pga-sk pga-sk--head" />
            <span className="pga-sk pga-sk--box" />
          </section>
        </aside>
      </div>
    </div>
  );
}

/** The verified share as a ring — the number is read, the ring is glanced at. */
function Donut({ pct }: { pct: number }) {
  const r = 22;
  const circumference = 2 * Math.PI * r;
  return (
    <svg className="pga-donut" width="58" height="58" viewBox="0 0 58 58" aria-hidden>
      <circle cx="29" cy="29" r={r} className="pga-donut__track" />
      <circle
        cx="29" cy="29" r={r} className="pga-donut__fill"
        strokeDasharray={`${(circumference * Math.min(100, Math.max(0, pct))) / 100} ${circumference}`}
        transform="rotate(-90 29 29)"
      />
      <text x="29" y="29" className="pga-donut__txt" dominantBaseline="central" textAnchor="middle">{pct}%</text>
    </svg>
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
/** A long value is cut at 25 characters; the whole of it is on hover. */
const FACT_MAX = 25;
function clip(v: ReactNode): { text: ReactNode; title?: string } {
  if (typeof v !== 'string' || v.length <= FACT_MAX) return { text: v };
  return { text: `${v.slice(0, FACT_MAX).trimEnd()}…`, title: v };
}

function Fact({ k, v, sub, tag, mono }: { k: string; v: ReactNode; sub?: string; tag?: ReactNode; mono?: boolean }) {
  const empty = v === null || v === undefined || v === '';
  const val = clip(v);
  const s = sub ? clip(sub) : null;
  return (
    <div className="pga-fact">
      <span className="pga-fact__k">{k}</span>
      <span className={`pga-fact__v${mono ? ' pga-mono' : ''}`} title={val.title}>{empty ? '—' : val.text}{tag}</span>
      {s && <span className="pga-fact__s" title={s.title}>{s.text}</span>}
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
