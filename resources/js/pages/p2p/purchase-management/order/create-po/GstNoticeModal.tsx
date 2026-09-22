// The two GST popups behind the banner's action: "stop" (scrutiny expired,
// PO blocked) and "warn" (return overdue, a senior may allow it).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { useToast } from '../../../../../contexts/ToastContext';
import { formatDmy } from '../../../../../utils/formatDmy';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { IcoShieldAlert, IcoUser } from '../shared/icons';
import { PoApiError, poApprovalApi, type GstApprover, type PoDetail } from '../api/po-api';

export type GstNotice = {
  tone: 'stop' | 'warn';
  supplier: string;
  code: string;
  scrutiny: string;
  filing: string;
  scrutinyAge: number | null;
  filingAge: number | null;
  /** The oldest date a scrutiny / filing may carry and still be accepted. */
  cutoff: string;
  months: number;
};

type Approval = NonNullable<PoDetail['gst_approval']>;

// Approvers rarely change within a session.
let approversCache: GstApprover[] | null = null;

/** `poId` + `onSent` send the senior-approval request; `approval` is the one already raised. */
export default function GstNoticeModal({ notice, onClose, poId, approval, onSent, onOpenScrutiny }: {
  notice: GstNotice; onClose: () => void; poId?: number | null; approval?: Approval | null; onSent?: () => void;
  /** Opens the supplier master on its GST Scrutiny tab; without it the button just closes. */
  onOpenScrutiny?: () => void;
}) {
  useScrollLock(true, '.cgst-card');
  const toast = useToast();
  const [note, setNote] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approvers, setApprovers] = useState<GstApprover[]>(approversCache ?? []);
  const [loadingApprovers, setLoadingApprovers] = useState(!approversCache);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const stop = notice.tone === 'stop';
  const pending = approval?.status === 'pending';
  const approved = approval?.status === 'approved';
  const canSend = !stop && !pending && !approved;
  /* A rejected PO goes back to the same senior — no picking a different one.
     The server enforces it too; here it just replaces the dropdown. */
  const sendBackTo = approval?.status === 'rejected' ? approval.requested_to_name : null;

  useEffect(() => {
    if (!canSend || sendBackTo || approversCache) return;
    poApprovalApi.approvers()
      .then((rows) => { approversCache = rows; setApprovers(rows); })
      .catch((e) => toast.error('Could not load approvers', e instanceof PoApiError ? e.firstError : 'Please try again.'))
      .finally(() => setLoadingApprovers(false));
  }, [canSend, sendBackTo, toast]);

  const send = async () => {
    if (!poId) { toast.warning('Save the PO first', 'The request is raised on a saved purchase order.'); return; }
    if (!sendBackTo && !approverId) { setError('Select the senior to send this request to.'); return; }
    setSending(true);
    try {
      await poApprovalApi.request(poId, {
        ...(sendBackTo ? {} : { requested_to: Number(approverId) }),
        note: note.trim() || undefined,
      });
      const who = sendBackTo ?? approvers.find((a) => String(a.id) === approverId)?.name ?? 'the senior';
      toast.success('Sent for senior approval', `${who} will see it in their Inbox.`);
      onSent?.();
      onClose();
    } catch (e) {
      const msg = e instanceof PoApiError ? e.firstError : 'Please try again.';
      setError(msg);
      toast.error('Could not send the request', msg);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Name first, then department and designation as tags; the company admin has no employee record.
  const options = approvers.map((a) => {
    const badges = [
      ...(a.department ? [{ text: a.department, tone: 'gray' as const }] : []),
      ...(a.designation ? [{ text: a.designation, tone: 'violet' as const }] : []),
      ...(!a.employee_id && a.user_type === 'client_admin' ? [{ text: 'Company admin', tone: 'green' as const }] : []),
    ];
    return {
      value: String(a.id),
      label: a.emp_code ? `${a.name} (${a.emp_code})` : a.name,
      fullLabel: [a.name, a.department, a.designation].filter(Boolean).join(' · '),
      badges,
    };
  });

  return createPortal(
    <div className="cgst-backdrop">
      <div className="cgst-card" role="dialog" aria-modal="true" aria-labelledby="cgst-title">
        <div className={`cgst-hd cgst-hd--${notice.tone}`}>
          <span className="cgst-hd__ico">{stop ? <IcoShieldAlert /> : <IcoUser />}</span>
          <span className="cgst-hd__txt">
            <span className="cgst-hd__t" id="cgst-title">{stop ? 'GST Scrutiny Required' : 'Senior Approval Required'}</span>
            <span className="cgst-hd__s">
              {stop ? `${notice.supplier} · ${notice.code}` : `Overdue GST filing · ${notice.supplier}`}
            </span>
          </span>
          <button type="button" className="cgst-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="cgst-bd">
          {stop ? (
            <p className="cgst-lead">
              This supplier’s GST scrutiny was last completed <b>{notice.scrutinyAge?.toFixed(1)} months ago</b>, outside
              the {notice.months}-month window. The purchase order cannot proceed until scrutiny is refreshed on the
              supplier record — a senior approval cannot clear this.
            </p>
          ) : (
            <p className="cgst-lead">
              GST scrutiny is current, but this supplier has not filed a return for <b>{notice.filingAge?.toFixed(1)} months</b>.
              A senior can still allow this purchase order to proceed.
            </p>
          )}

          <div className="cgst-rows">
            {!stop && <Row label="Supplier" value={notice.supplier} />}
            <Row
              label="Scrutiny date"
              value={formatDmy(notice.scrutiny)}
              tag={stop ? 'Expired' : 'Current'}
              tagTone={stop ? 'stop' : 'ok'}
            />
            {stop && <Row label="Required on or after" value={formatDmy(notice.cutoff)} />}
            <Row
              label="Last GST filing"
              value={formatDmy(notice.filing)}
              tag={stop ? undefined : `${notice.filingAge?.toFixed(1)} months ago`}
              tagTone="warn"
            />
            {!stop && <Row label="Required on or after" value={formatDmy(notice.cutoff)} />}
          </div>

          {approval && !stop && <ApprovalState approval={approval} />}

          {stop ? (
            <div className="cgst-note">Once scrutiny is updated, reopen this PO and the check will re-run automatically.</div>
          ) : canSend && (
            <>
              {sendBackTo ? (
                /* Re-send: the same senior, stated, not chosen again. */
                <div className="cgst-field">
                  <label>Goes back to</label>
                  <div className="cgst-same">
                    <span className="cgst-same__av">{sendBackTo.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                    <span className="cgst-same__n">{sendBackTo}</span>
                    <span className="cgst-same__s">the senior who rejected it</span>
                  </div>
                  {error && <span className="cgst-err">{error}</span>}
                </div>
              ) : (
              <div className="cgst-field">
                <label>Send to <span className="cgst-req">*</span></label>
                <MasterSelect
                  value={approverId}
                  options={options}
                  placeholder={loadingApprovers ? 'Loading…' : '— Select senior —'}
                  loading={loadingApprovers}
                  invalid={!!error && !approverId}
                  emptyText="No other active users in your company"
                  onChange={(v) => { setApproverId(v); setError(''); }}
                />
                {error && <span className="cgst-err">{error}</span>}
              </div>
              )}
              <div className="cgst-field">
                <label htmlFor="cgst-note">Note for the approver <span className="cgst-opt">optional</span></label>
                <textarea
                  id="cgst-note"
                  className="cgst-ta"
                  maxLength={1000}
                  placeholder="Why this PO should still go through…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="cgst-ft">
          <button type="button" className="cgst-btn cgst-btn--ghost" onClick={onClose}>{canSend ? 'Cancel' : 'Close'}</button>
          {stop && onOpenScrutiny && (
            <button type="button" className="cgst-btn cgst-btn--stop" onClick={() => { onClose(); onOpenScrutiny(); }}>Open Supplier GST Scrutiny</button>
          )}
          {canSend && (
            <button type="button" className="cgst-btn cgst-btn--warn" onClick={send} disabled={sending}>
              {sending ? 'Sending…' : approval?.status === 'rejected' ? 'Send Again for Approval' : 'Send for Senior Approval'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Where the last request stands: waiting, approved, or rejected with the senior's reason. */
function ApprovalState({ approval }: { approval: Approval }) {
  const who = approval.requested_to_name ?? 'the senior';
  const when = (d: string | null) => (d ? formatDmy(d.slice(0, 10)) : '');
  if (approval.status === 'pending') {
    return <div className="cgst-state cgst-state--pending">Waiting on <b>{who}</b> since {when(approval.requested_at)}. You can submit once it is approved.</div>;
  }
  if (approval.status === 'approved') {
    return <div className="cgst-state cgst-state--ok">Approved by <b>{who}</b> on {when(approval.decided_at)} — “{approval.reason}”. You can submit the PO.</div>;
  }
  return <div className="cgst-state cgst-state--bad">Rejected by <b>{who}</b> on {when(approval.decided_at)} — “{approval.reason}”. Send it again, or fix the supplier’s GST.</div>;
}

function Row({ label, value, tag, tagTone = 'ok' }: { label: string; value: string; tag?: string; tagTone?: 'ok' | 'warn' | 'stop' }) {
  return (
    <div className="cgst-row">
      <span className="cgst-row__k">{label}</span>
      <span className="cgst-row__v">
        {value}
        {tag && <span className={`cgst-tag cgst-tag--${tagTone}`}>{tag}</span>}
      </span>
    </div>
  );
}
