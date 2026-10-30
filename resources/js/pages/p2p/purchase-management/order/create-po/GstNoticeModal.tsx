import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { useToast } from '../../../../../contexts/ToastContext';
import { formatDmy } from '../../../../../utils/formatDmy';
import { shortDesignation } from '../../../../../utils/positionHierarchy';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { IcoShieldAlert, IcoUser } from '../shared/icons';
import { PoApiError, poApprovalApi, type GstApprover, type PoDetail } from '../api/po-api';
import { DOC_THIS, type CheckDoc } from './supplier-checks';

export type GstNotice = {
  tone: 'stop' | 'warn';
  supplier: string;
  code: string;
  scrutiny: string;
  filing: string;
  scrutinyAge: number | null;
  filingAge: number | null;
  cutoff: string;
  months: number;
};

type Approval = NonNullable<PoDetail['gst_approval']>;

export default function GstNoticeModal({
  notice, onClose, poId, approval, onSent, onOpenScrutiny, doc = 'PO', onRequest,
}: {
  notice: GstNotice; onClose: () => void; poId?: number | null; approval?: Approval | null; onSent?: () => void;
  onRequest?: (body: { requested_to?: number; note?: string }) => Promise<unknown>;
  onOpenScrutiny?: () => void;
  doc?: CheckDoc;
}) {
  const THIS = DOC_THIS[doc];
  const This = THIS.charAt(0).toUpperCase() + THIS.slice(1);
  useScrollLock(true, '.cgst-card');
  const toast = useToast();
  const [note, setNote] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approvers, setApprovers] = useState<GstApprover[]>([]);
  const [loadingApprovers, setLoadingApprovers] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const stop = notice.tone === 'stop';
  const pending = approval?.status === 'pending';
  const approved = approval?.status === 'approved';
  const canSend = !stop && !pending && !approved;
  const sendBackTo = approval?.status === 'rejected' ? approval.requested_to_name : null;

  useEffect(() => {
    if (!canSend || sendBackTo) return;
    poApprovalApi.approvers()
      .then((rows) => setApprovers(rows))
      .catch((e) => toast.error('Could not load approvers', e instanceof PoApiError ? e.firstError : 'Please try again.'))
      .finally(() => setLoadingApprovers(false));
  }, [canSend, sendBackTo, toast]);

  const send = async () => {
    if (!poId && !onRequest) {
      toast.warning(
        doc === 'PO' ? 'Save the PO first' : 'No purchase order to approve against',
        doc === 'PO'
          ? 'The request is raised on a saved purchase order.'
          : `The request is raised on a purchase order, and ${THIS} has none.`,
      );
      return;
    }
    if (!sendBackTo && !approverId) { setError('Select the senior to send this request to.'); return; }
    setSending(true);
    try {
      const body = {
        ...(sendBackTo ? {} : { requested_to: Number(approverId) }),
        note: note.trim() || undefined,
      };
      if (onRequest) await onRequest(body);
      else await poApprovalApi.request(poId!, body);
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const options = approvers.map((a) => {
    const badges = [
      ...(a.department ? [{ text: a.department, tone: 'gray' as const }] : []),
      ...(a.designation ? [{ text: shortDesignation(a.designation), title: a.designation, tone: 'violet' as const }] : []),
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
      <div className="cgst-shell">
      <div className="cgst-card" role="dialog" aria-modal="true" aria-labelledby="cgst-title">
        <div className={`cgst-hd cgst-hd--${notice.tone}`}>
          <span className="cgst-hd__ico">{stop ? <IcoShieldAlert /> : <IcoUser />}</span>
          <span className="cgst-hd__txt">
            <span className="cgst-hd__t" id="cgst-title">{stop ? 'GST Scrutiny Required' : 'Senior Approval Required'}</span>
            <span className="cgst-hd__s">
              {stop ? `${notice.supplier} · ${notice.code}` : `Overdue GST filing · ${notice.supplier}`}
            </span>
          </span>
          <button type="button" className="cgst-x" onClick={onClose} aria-label="Close" disabled={sending}>✕</button>
        </div>

        <div className="cgst-bd">
          {stop ? (
            <p className="cgst-lead">
              This supplier’s GST scrutiny was last completed <b>{notice.scrutinyAge?.toFixed(1)} months ago</b>, outside
              the {notice.months}-month window. {This} cannot proceed until scrutiny is refreshed on the
              supplier record — a senior approval cannot clear this.
            </p>
          ) : (
            <p className="cgst-lead">
              GST scrutiny is current, but this supplier has not filed a return for <b>{notice.filingAge?.toFixed(1)} months</b>.
              A senior can still allow {THIS} to proceed.
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
            <div className="cgst-note">Once scrutiny is updated, reopen {THIS} and the check will re-run automatically.</div>
          ) : canSend && (
            <>
              {sendBackTo ? (
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
                  placeholder={`Why ${THIS} should still go through…`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="cgst-ft">
          <button type="button" className="cgst-btn cgst-btn--ghost" onClick={onClose} disabled={sending}>{canSend ? 'Cancel' : 'Close'}</button>
          {stop && onOpenScrutiny && (
            <button type="button" className="cgst-btn cgst-btn--stop" onClick={() => { onClose(); onOpenScrutiny(); }}>Open Supplier GST Scrutiny</button>
          )}
          {canSend && (
            <button type="button" className="cgst-btn cgst-btn--warn" onClick={send} disabled={sending}>
              {approval?.status === 'rejected' ? 'Send Again for Approval' : 'Send for Senior Approval'}
            </button>
          )}
        </div>
      </div>

      {sending && (
        <div className="cgst-busy" role="status" aria-live="polite">
          <span className="cgst-busy__ring" aria-hidden="true" />
          <span className="cgst-busy__t">Sending for senior approval</span>
          <span className="cgst-busy__s">Don&rsquo;t close this window.</span>
        </div>
      )}
      </div>
    </div>,
    document.body,
  );
}

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
