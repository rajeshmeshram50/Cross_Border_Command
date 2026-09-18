// The two GST popups behind the compliance banner's action button:
//  · "stop"  — scrutiny is out of date, the PO cannot proceed
//  · "warn"  — scrutiny is fine but the return is overdue, a senior may allow it
// Same shell, different colour and content, so they live in one component.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { formatDmy } from '../../../../../utils/formatDmy';

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

// Static until the approvals API exists.
const APPROVERS = [
  'Rajiv Menon · Head of Procurement',
  'Sneha Kulkarni · Finance Controller',
  'Amit Deshpande · Director',
];

export default function GstNoticeModal({ notice, onClose }: { notice: GstNotice; onClose: () => void }) {
  useScrollLock(true, '.cgst-card');
  const [approver, setApprover] = useState(APPROVERS[0]);
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = notice.tone === 'stop';

  return createPortal(
    <div className="cgst-backdrop">
      <div className="cgst-card" role="dialog" aria-modal="true" aria-labelledby="cgst-title">
        <div className={`cgst-hd cgst-hd--${notice.tone}`}>
          <span className="cgst-hd__ico">{stop ? <IcoShield /> : <IcoUser />}</span>
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
              supplier record.
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

          {stop ? (
            <div className="cgst-note">Once scrutiny is updated, reopen this PO and the check will re-run automatically.</div>
          ) : (
            <>
              <div className="cgst-field">
                <label htmlFor="cgst-approver">Send to</label>
                <select
                  id="cgst-approver"
                  className="cgst-sel"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                >
                  {APPROVERS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="cgst-field">
                <label htmlFor="cgst-note">Note for the approver <span className="cgst-opt">optional</span></label>
                <textarea
                  id="cgst-note"
                  className="cgst-ta"
                  placeholder="Why this PO should still go through…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="cgst-ft">
          <button type="button" className="cgst-btn cgst-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className={`cgst-btn cgst-btn--${notice.tone}`} onClick={onClose}>
            {stop ? 'Open Supplier GST Scrutiny' : 'Send for Senior Approval'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
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

const S = { fill: 'none', stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
function IcoShield() { return <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="13" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>; }
function IcoUser() { return <svg width="20" height="20" viewBox="0 0 24 24" {...S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>; }
