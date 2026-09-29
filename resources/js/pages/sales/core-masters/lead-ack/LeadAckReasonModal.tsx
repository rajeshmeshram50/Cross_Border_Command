import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { LEAD_ACK_CSS } from './leadAckStyles';

/* ────────────────────────────────────────────────────────────────────────────
 * Lead Acknowledgement — Add / Edit Reason popup.
 *
 * The master page's two-step popup ("Select Opportunity Type" → "Add …
 * Reason" form), lifted out so Sales Matrix Stage 2 adds reasons through the
 * very same popup instead of a look-alike (QA #70). Both callers write to
 * /sales/lead-ack-reasons with the same validation, toasts and branch scope.
 *
 *   - Add:  opens on "Select Opportunity Type"; `presetType` skips straight to
 *           the form for that type (Stage 2's reason picker already knows it).
 *   - Edit: pass `editing` — opens on the form, filled in.
 *
 * Rendered in a portal with the master's stylesheet, so it looks identical
 * wherever it is opened from.
 * ──────────────────────────────────────────────────────────────────────── */

export type OppType = 'qualified' | 'disqualified' | 'clarity_pending';
export type Status  = 'active' | 'inactive';
export type DQ      = 'positive' | 'negative';

export type LeadAckReason = {
  id: number;
  opportunity_type: OppType;
  reason: string;
  status: Status;
  dq_status: DQ | null;
};

export const LEAD_ACK_TYPE_LABELS: Record<OppType, string> = {
  qualified: 'Qualified Opportunity',
  disqualified: 'Disqualified Opportunity',
  clarity_pending: 'Clarity Pending Opportunity',
};
const TYPE_SHORT: Record<OppType, string> = {
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  clarity_pending: 'Clarity Pending',
};

type Props = {
  open: boolean;
  /** Row to edit. Omit (or null) to add a new reason. */
  editing?: LeadAckReason | null;
  /** Add straight into this type, skipping "Select Opportunity Type". */
  presetType?: OppType | null;
  onClose: () => void;
  onSaved: (row: LeadAckReason, mode: 'add' | 'edit') => void;
};

export default function LeadAckReasonModal({ open, editing = null, presetType = null, onClose, onSaved }: Props) {
  const toast = useToast();
  const { user } = useAuth();
  // Active branch (from the switcher) so writes are scoped to the SAME branch
  // the list is showing — the Axios interceptor only injects branch_id on GETs,
  // so POST/PUT must pass it explicitly to keep reasons branch-isolated.
  const branchParam = (): { branch_id?: number } => {
    try {
      const s = user?.id ? localStorage.getItem(`cbc_selected_branch_id_${user.id}`) : null;
      const n = s ? Number(s) : NaN;
      return Number.isFinite(n) && n > 0 ? { branch_id: n } : {};
    } catch { return {}; }
  };

  const [step, setStep]               = useState<'select' | 'form'>('select');
  const [pendingType, setPendingType] = useState<OppType | null>(null);
  const [formReason, setFormReason]   = useState('');
  const [formStatus, setFormStatus]   = useState<Status>('active');
  const [formDQ,     setFormDQ]       = useState<DQ>('positive');
  const [formError,  setFormError]    = useState('');
  const [saving,     setSaving]       = useState(false);

  // The form flashes a field skeleton on open before the inputs settle in,
  // so it materialises with the same shimmer language as the table.
  const [formLoading, setFormLoading] = useState(false);
  const formTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (formTimer.current) window.clearTimeout(formTimer.current);
  }, []);
  const flashFormSkeleton = () => {
    setFormLoading(true);
    if (formTimer.current) window.clearTimeout(formTimer.current);
    formTimer.current = window.setTimeout(() => setFormLoading(false), 400);
  };

  const startForm = (t: OppType) => {
    setPendingType(t);
    setFormReason('');
    setFormStatus('active');
    setFormDQ('positive');
    setFormError('');
    setStep('form');
    flashFormSkeleton();
  };

  // Each open starts fresh: edit → filled form, preset → blank form of that
  // type, otherwise the type selector.
  useEffect(() => {
    if (!open) return;
    setSaving(false);
    if (editing) {
      setPendingType(editing.opportunity_type);
      setFormReason(editing.reason);
      setFormStatus(editing.status);
      setFormDQ(editing.dq_status ?? 'positive');
      setFormError('');
      setStep('form');
      flashFormSkeleton();
    } else if (presetType) {
      startForm(presetType);
    } else {
      setPendingType(null);
      setStep('select');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => { if (!saving) onClose(); };

  // Escape closes the popup. Saving disables the shortcut so a stray key
  // press can't abandon an in-flight request.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!saving) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, saving, onClose]);

  // Lock scroll while open — lock BOTH <html> and <body> so the page behind
  // can't scroll regardless of which owns the viewport scroll.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  const save = async () => {
    const reason = formReason.trim();
    if (!reason) { setFormError('⚠  Reason is required.'); return; }
    if (!/[\p{L}\p{N}]/u.test(reason)) {
      setFormError('⚠  Reason must contain letters or numbers, not only special characters.');
      return;
    }
    if (!pendingType) { setFormError('Internal error: opportunity type missing.'); return; }
    setFormError('');
    setSaving(true);
    try {
      if (editing) {
        const payload: any = { reason, status: formStatus };
        if (pendingType === 'disqualified') payload.dq_status = formDQ;
        const res = await api.put(`/sales/lead-ack-reasons/${editing.id}`, payload, { params: branchParam() });
        toast.success('Saved', 'Reason updated successfully');
        onSaved(res.data, 'edit');
      } else {
        const payload: any = {
          opportunity_type: pendingType,
          reason,
          status: formStatus,
        };
        if (pendingType === 'disqualified') payload.dq_status = formDQ;
        const res = await api.post('/sales/lead-ack-reasons', payload, { params: branchParam() });
        toast.success('Added', `Reason added to ${LEAD_ACK_TYPE_LABELS[pendingType]}`);
        onSaved(res.data, 'add');
      }
      setSaving(false);
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to save reason';
      setFormError(msg);
      toast.error('Save failed', msg);
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal((
    <div className="lam-modal-scope">
      <style>{LEAD_ACK_CSS}{SCOPE_CSS}</style>

      {/* ── Opportunity-type selector ── */}
      {/* No backdrop-click-to-close — users were losing partially filled
          forms by misclicking the overlay. Close only via the X / Cancel
          button or the ESC key. */}
      {step === 'select' && (
        <div className="lam-overlay">
          <div className="lam-modal lam-modal-md" onMouseDown={e => e.stopPropagation()}>
            <div className="lam-modal-header">
              <div className="lam-modal-hicon"><i className="ri-folder-add-line" /></div>
              <div className="lam-modal-htext">
                <div className="lam-modal-title">Select Opportunity Type</div>
                <div className="lam-modal-sub">Choose where to store this reason</div>
              </div>
              <button type="button" className="lam-modal-close" onClick={close} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
            <div className="lam-modal-body">
              <p className="lam-modal-helper">Select the opportunity type for which you want to add a new reason:</p>
              <div className="lam-opp-options">
                <button type="button" className="lam-opp lam-opp-qualified" onClick={() => startForm('qualified')}>
                  <div className="lam-opp-icon"><i className="ri-checkbox-circle-line" /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Qualified Opportunity</div>
                    <div className="lam-opp-sub">Add reason for qualifying a lead</div>
                  </div>
                  <i className="ri-arrow-right-s-line lam-opp-chev" />
                </button>
                <button type="button" className="lam-opp lam-opp-disqualified" onClick={() => startForm('disqualified')}>
                  <div className="lam-opp-icon"><i className="ri-close-circle-line" /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Disqualified Opportunity</div>
                    <div className="lam-opp-sub">Add reason for disqualifying a lead</div>
                  </div>
                  <i className="ri-arrow-right-s-line lam-opp-chev" />
                </button>
                <button type="button" className="lam-opp lam-opp-clarity" onClick={() => startForm('clarity_pending')}>
                  <div className="lam-opp-icon"><i className="ri-question-line" /></div>
                  <div className="lam-opp-text">
                    <div className="lam-opp-title">Clarity Pending Opportunity</div>
                    <div className="lam-opp-sub">Add reason for pending clarification</div>
                  </div>
                  <i className="ri-arrow-right-s-line lam-opp-chev" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit form — clean two-column form. Reason textarea spans the
              full width; Status / DQ Status sit side-by-side in equal columns. ── */}
      {step === 'form' && pendingType && (
        /* No backdrop-click-to-close — users were losing partially filled
           forms by misclicking the overlay. Close only via Cancel or ESC. */
        <div className="lam-overlay lam-overlay-strong">
          <div className="lam-modal lam-modal-lg lam-modal-noclose" onMouseDown={e => e.stopPropagation()}>
            <div className="lam-modal-header lam-modal-header-rich">
              <span className="lam-mh-orb lam-mh-orb-tr" aria-hidden />
              <span className="lam-mh-orb lam-mh-orb-br" aria-hidden />
              <span className="lam-mh-orb lam-mh-orb-bl" aria-hidden />
              <span className="lam-mh-sheen" aria-hidden />
              <div className="lam-modal-hicon">
                <i className={editing ? 'ri-edit-line' : 'ri-add-circle-line'} />
              </div>
              <div className="lam-modal-htext">
                <div className="lam-modal-title">{editing ? 'Edit Reason' : `Add ${TYPE_SHORT[pendingType]} Reason`}</div>
                <div className="lam-modal-sub">{LEAD_ACK_TYPE_LABELS[pendingType]}</div>
              </div>
            </div>

            <div className="lam-modal-body">
              {formLoading ? (
                /* Field skeleton — mirrors the real form shape (label +
                   textarea, then the Status / DQ Status row) so the inputs
                   resolve in place rather than popping in cold. */
                <>
                  <div className="lam-fld">
                    <span className="lam-skel lam-skel-flabel" />
                    <span className="lam-skel lam-skel-ftext" />
                  </div>
                  <div className={`lam-row ${pendingType === 'disqualified' ? 'cols-2' : 'cols-1'}`} style={{ marginTop: 18 }}>
                    <div className="lam-fld">
                      <span className="lam-skel lam-skel-flabel" />
                      <span className="lam-skel lam-skel-finput" />
                    </div>
                    {pendingType === 'disqualified' && (
                      <div className="lam-fld">
                        <span className="lam-skel lam-skel-flabel" />
                        <span className="lam-skel lam-skel-finput" />
                      </div>
                    )}
                  </div>
                </>
              ) : (<>
              {/* Reason — full width row */}
              <div className="lam-fld">
                <label className="lam-lbl">Reason <span className="lam-req">*</span></label>
                <textarea
                  className="lam-textarea"
                  placeholder="Enter reason (max 500 characters)"
                  maxLength={500}
                  rows={3}
                  value={formReason}
                  onChange={e => setFormReason(e.target.value)}
                />
                <div className={`lam-char-count ${formReason.length >= 450 ? (formReason.length >= 500 ? 'lam-cc-max' : 'lam-cc-warn') : ''}`}>
                  <span>{formReason.length}</span>
                  <span className="lam-char-max">/500</span>
                </div>
              </div>

              {/* Status / DQ Status — equal-width 2-column row */}
              <div className={`lam-row ${pendingType === 'disqualified' ? 'cols-2' : 'cols-1'}`}>
                <div className="lam-fld">
                  <label className="lam-lbl">Status <span className="lam-req">*</span></label>
                  <MasterSelect
                    value={formStatus}
                    options={[
                      { value: 'active',   label: 'Active' },
                      { value: 'inactive', label: 'Inactive' },
                    ]}
                    onChange={(v) => setFormStatus(v as Status)}
                  />
                </div>
                {pendingType === 'disqualified' && (
                  <div className="lam-fld">
                    <label className="lam-lbl">DQ Status <span className="lam-req">*</span></label>
                    <MasterSelect
                      value={formDQ}
                      options={[
                        { value: 'positive', label: 'Positive' },
                        { value: 'negative', label: 'Negative' },
                      ]}
                      onChange={(v) => setFormDQ(v as DQ)}
                    />
                  </div>
                )}
              </div>

              {formError && <div className="lam-error"><i className="ri-error-warning-line" /> {formError}</div>}
              </>)}
            </div>

            <div className="lam-modal-footer lam-modal-footer-right">
              <div className="lam-footer-actions">
                <button type="button" className="lam-btn lam-btn-light" onClick={close} disabled={saving}>Cancel</button>
                <button type="button" className="lam-btn lam-btn-primary" onClick={save} disabled={saving}>
                  {saving ? <>
                    <span className="lam-spinner" aria-hidden />
                    Saving…
                  </> : <>
                    <i className="ri-save-3-line" />
                    Save Reason
                  </>}
                </button>
              </div>
            </div>
            {/* While saving, lock the whole form so no other field/button can be used. */}
            {saving && (
              <div className="lam-save-lock" aria-live="polite" aria-busy="true">
                <span className="lam-save-lock-spinner" />
                <span className="lam-save-lock-text">{editing ? 'Updating…' : 'Saving…'}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  ), document.body);
}

/* On the master page the popup inherited these from .lam-root; in a portal it
   carries them itself so it reads the same from any page. */
const SCOPE_CSS = `
.lam-modal-scope { font-family: var(--font-sans); color: #111827; font-size: 13.5px; }
.lam-modal-scope *, .lam-modal-scope *::before, .lam-modal-scope *::after { box-sizing: border-box; }
`;
