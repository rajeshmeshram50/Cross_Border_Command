import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import { useToast } from '../../contexts/ToastContext';
import { regularizationApi, type ApiRegularization } from './regularizationApi';
import { MasterTimePicker } from '../../components/ui/MasterTimePicker';
// The keka modal styling (att-reg-keka-*) lives in recruitment.css. Import it
// here so the modal is styled wherever it's used — notably inside the Employee
// Profile overlay, which does NOT otherwise load recruitment.css.
import '../../../css/recruitment.css';

interface PunchEdit {
  action: 'add' | 'edit' | 'keep' | 'delete';
  oldIn?: string;
  oldOut?: string;
  newIn: string;
  newOut: string;
}

/** Punch shape the modal can prefill its "adjust" rows from. Matches both the
 *  HR Attendance PunchEvent and the simpler employee-profile punch list. */
export interface RegPrefillPunch {
  time: string;
  type: 'in' | 'out' | 'missing';
}

const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** "2026-05-02" → "2 May 2026" for the read-only Selected Date field. */
function fmtDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '';
  const [, y, mo, d] = m;
  return `${Number(d)} ${MONTHS_LONG[Number(mo) - 1]} ${y}`;
}

/** "09:40" → "09:40 AM", "18:30" → "06:30 PM" for the shift-timings display. */
function fmt12h(hhmm?: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm || '').trim());
  if (!m) return hhmm || '';
  const h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${m[2]} ${ampm}`;
}

interface Props {
  open: boolean;
  /** Employee whose attendance is being regularized. Always sent to the API;
   *  the backend decides self vs. file-on-behalf from the auth user. */
  employeeId: number;
  /** Manager name shown in the success toast (optional). */
  managerName?: string;
  /** ISO date (YYYY-MM-DD) of the day being regularized. */
  dateIso: string;
  /** Shift window for the day, 24h "HH:MM" — shown as "Shift timings". */
  shiftStart?: string;
  shiftEnd?: string;
  /** The employee's shift NAME (e.g. "Evening Shift"), shown above the window
   *  so it's obvious which of the branch's configured shifts these times are. */
  shiftName?: string | null;
  /** Existing punches for the day, used to prefill the adjustment rows. */
  initialPunches?: RegPrefillPunch[];
  onClose: () => void;
  /** Fired after a successful submit with the persisted row. */
  onSubmitted?: (row: ApiRegularization) => void;
}

export default function RegularizationModal({
  open, employeeId, managerName, dateIso, shiftStart, shiftEnd, shiftName, initialPunches, onClose, onSubmitted,
}: Props) {
  const toast = useToast();

  const initialEdits = useMemo<PunchEdit[]>(() => {
    const inOuts: { in?: string; out?: string }[] = [];
    let cur: { in?: string; out?: string } = {};
    for (const p of (initialPunches ?? [])) {
      if (p.type === 'in')  { cur = { in: p.time.replace(/\s?(AM|PM)/i, '') }; }
      if (p.type === 'out') { cur.out = p.time.replace(/\s?(AM|PM)/i, ''); inOuts.push(cur); cur = {}; }
    }
    if (cur.in) inOuts.push(cur);
    return inOuts.length === 0
      ? [{ action: 'add' as const, newIn: '', newOut: '' }]
      : inOuts.map(io => ({ action: 'keep' as const, oldIn: io.in, oldOut: io.out, newIn: io.in ?? '', newOut: io.out ?? '' }));
  }, [initialPunches]);

  /* Punches may only be picked inside the employee's shift window, so the time
     columns are clamped to it. Two cases are deliberately left UNCLAMPED:
       · a shift that crosses midnight (end <= start, e.g. 20:00–04:00) — a
         legitimate punch sits on either side of the boundary, which a simple
         min/max range can't express, so restricting it would block valid times;
       · no resolvable shift window at all.
     Existing out-of-window punches are never rewritten — they stay visible and
     submittable; the bounds only govern what the picker OFFERS. */
  const shiftMinutes = (v?: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec((v || '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const startMin = shiftMinutes(shiftStart);
  const endMin   = shiftMinutes(shiftEnd);
  const clampable = startMin != null && endMin != null && endMin > startMin;
  const windowMin = clampable ? shiftStart : undefined;
  const windowMax = clampable ? shiftEnd   : undefined;

  const [punchEdits, setPunchEdits] = useState<PunchEdit[]>(initialEdits);
  const [reason, setReason]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors]       = useState<Partial<Record<'reason' | 'punches', string>>>({});

  useEffect(() => { setPunchEdits(initialEdits); }, [initialEdits]);
  // Reset transient fields each time the modal (re)opens for a fresh day.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setErrors({});
  }, [open, dateIso]);

  const updateEdit = (idx: number, patch: Partial<PunchEdit>) => {
    setPunchEdits(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const next = { ...e, ...patch };
      if (e.action === 'keep' && (next.newIn !== e.oldIn || next.newOut !== e.oldOut)) {
        next.action = 'edit';
      }
      return next;
    }));
  };
  const addEdit = () => setPunchEdits(prev => [...prev, { action: 'add', newIn: '', newOut: '' }]);
  const removeEdit = (idx: number) => {
    setPunchEdits(prev => prev.flatMap((e, i) => {
      if (i !== idx) return [e];
      if (e.action === 'add') return [];
      return [{ ...e, action: 'delete' as const, newIn: '', newOut: '' }];
    }));
  };

  const submit = async () => {
    if (submitting) return;
    const errs: typeof errors = {};
    if (!reason.trim()) errs.reason = 'Reason is required';
    const valid = punchEdits.some(e => e.action !== 'delete');
    const allOk = punchEdits.every(e =>
      e.action === 'delete' ||
      (e.newIn && /^\d{2}:\d{2}$/.test(e.newIn) && (!e.newOut || /^\d{2}:\d{2}$/.test(e.newOut)))
    );
    if (!valid) errs.punches = 'Add at least one punch entry';
    else if (!allOk) errs.punches = 'All punch entries need a valid HH:MM time';
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Validation', 'Fix the highlighted fields');
      return;
    }
    setErrors({});

    const punches = punchEdits
      .filter(e => e.action !== 'delete' && e.newIn)
      .map(e => ({ in: e.newIn, out: e.newOut || null }));

    setSubmitting(true);
    try {
      const row = await regularizationApi.create({
        employee_id: employeeId,
        regularization_date: dateIso,
        mode: 'adjust',
        type: 'Forgot to Punch',
        punches,
        reason: reason.trim(),
      });
      // Prefer the ACTUAL approver the backend routed to (bug #29) — the old
      // `managerName` prop was just the org-chart reporting manager and could
      // misname who really approves. Fall back to that prop, then generic.
      const pa = row.pending_approver_label;
      const approverText = row.auto_approved
        ? 'Auto-approved — no approver assigned'
        : pa?.name
          ? `Routed to ${pa.name} for approval`
          : pa?.role
            ? `Routed to ${pa.role} for approval`
            : managerName
              ? `Routed to ${managerName} for approval`
              : 'Routed for approval';
      toast.success('Submitted', approverText);
      onSubmitted?.(row);
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Could not submit request';
      toast.error('Could not submit request', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      toggle={onClose}
      centered
      size="lg"
      backdrop="static"
      className="att-reg-modal-keka"
      /* Lift above the Employee Profile full-screen overlay (z-index 1080);
         reactstrap applies this to both the modal and its backdrop. */
      zIndex={2100}
    >
      <ModalBody className="p-0">
        <div className="att-reg-modal-v3">
          <div className="att-reg-keka-head">
            <div className="att-reg-keka-title">Request Attendance Regularization</div>
            <button type="button" className="att-reg-keka-close" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>

          <div className="att-reg-keka-body">
            <div className="d-flex gap-3 flex-wrap">
              <div className="att-reg-keka-field flex-grow-1">
                <label className="att-reg-keka-label">Selected Date</label>
                <div className="att-reg-keka-readonly">{fmtDateLabel(dateIso)}</div>
              </div>
              {shiftStart && shiftEnd && (
                <div className="att-reg-keka-field flex-grow-1">
                  <label className="att-reg-keka-label">Shift Timings</label>
                  {/* Name + window together — the window alone ("06:00 AM -
                      12:00 PM") looked wrong to anyone expecting office hours
                      until they could see it's the Evening Shift the employee
                      is actually assigned to in the branch's Shift Details. */}
                  <div className="att-reg-keka-readonly">
                    {shiftName ? <><strong>{shiftName}</strong> · </> : null}
                    {fmt12h(shiftStart)} - {fmt12h(shiftEnd)}
                  </div>
                </div>
              )}
            </div>

            <div className="att-reg-keka-modes">
              <label className="att-reg-keka-radio is-active">
                <input type="radio" name="reg-mode" checked readOnly />
                <span className="att-reg-keka-radio-dot" />
                <span>Add/update time entries to adjust attendance logs.</span>
              </label>
              <div className="att-reg-keka-hint">
                Click and select time stamp box that you would like to adjust and make changes to the time
                {clampable && (
                  <> · Times outside <strong>{fmt12h(shiftStart!)} – {fmt12h(shiftEnd!)}</strong> are unavailable — a punch has to fall inside the shift.</>
                )}
              </div>
            </div>

            {(
              <>
                <div className="att-reg-keka-section-head">
                  <div className="att-reg-keka-section-title">Attendance Adjustment</div>
                  <button type="button" className="att-reg-keka-addlog" onClick={addEdit}>
                    <i className="ri-add-line" />Add Log
                  </button>
                </div>

                <div className="att-reg-keka-rows">
                  {punchEdits.filter(e => e.action !== 'delete').map((e) => {
                    const realIdx = punchEdits.indexOf(e);
                    return (
                      <div key={realIdx} className="att-reg-keka-row">
                        <i className="ri-arrow-left-down-line att-reg-keka-arrow att-reg-keka-arrow--in" />
                        {/* Custom HH:MM picker (minute-by-minute) replaces the
                            native <input type="time"> whose browser dropdown
                            rendered minutes with uneven spacing and couldn't be
                            styled (bug #16). showNow=false — regularization is
                            always for a past day, so "Now" is meaningless. */}
                        <div className="att-reg-keka-time-wrap">
                          <MasterTimePicker
                            minuteStep={1}
                            showNow={false}
                            hour12
                            accent="teal"
                            minTime={windowMin}
                            maxTime={windowMax}
                            value={e.newIn}
                            onChange={v => updateEdit(realIdx, { newIn: v })}
                          />
                        </div>
                        <i className="ri-arrow-right-up-line att-reg-keka-arrow att-reg-keka-arrow--out" />
                        <div className="att-reg-keka-time-wrap">
                          <MasterTimePicker
                            minuteStep={1}
                            showNow={false}
                            hour12
                            accent="teal"
                            minTime={windowMin}
                            maxTime={windowMax}
                            value={e.newOut}
                            onChange={v => updateEdit(realIdx, { newOut: v })}
                          />
                        </div>
                        <button type="button" className="att-reg-keka-rm" onClick={() => removeEdit(realIdx)} title="Remove">
                          <i className="ri-subtract-line" />
                        </button>
                      </div>
                    );
                  })}
                  {punchEdits.filter(e => e.action !== 'delete').length === 0 && (
                    <div className="att-reg-keka-empty">Click <strong>Add Log</strong> to add a punch entry.</div>
                  )}
                </div>
                {errors.punches && <small className="att-reg-keka-error">{errors.punches}</small>}
              </>
            )}

            <div className="att-reg-keka-field">
              <label className="att-reg-keka-label">Note</label>
              <textarea
                className="form-control att-reg-keka-note"
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Enter note"
              />
              {errors.reason && <small className="att-reg-keka-error">{errors.reason}</small>}
            </div>
          </div>

          <div className="att-reg-keka-foot">
            <button type="button" className="att-reg-keka-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="att-reg-keka-submit" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Request'}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
