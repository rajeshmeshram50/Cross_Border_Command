import { useEffect, useMemo, useRef, useState } from 'react';
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

/** "HH:MM" → minutes past midnight, or null when unparseable. */
function toMinutes(hhmm?: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const i = Number(m[2]);
  return h > 23 || i > 59 ? null : h * 60 + i;
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

  /* The pickers stay UNRESTRICTED — any time of day can be typed. Greying the
     out-of-shift hours out would block the correction the screen exists for
     (an early arrival, a shift changed after the fact, a night shift crossing
     midnight). What is enforced instead is what gets STORED: the server bounds
     every punch to the assigned shift, because regularization corrects a day
     the reader got wrong — it is not a way to claim overtime, which has to come
     from a real punch at the device. So rather than disable the input, we warn
     below the moment a picked time falls outside the window. */

  const [punchEdits, setPunchEdits] = useState<PunchEdit[]>(initialEdits);
  const [reason, setReason]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  /* Re-entrancy guard. `submitting` state alone can't stop a fast double-click:
     the second click runs against the closure captured BEFORE the re-render
     that disables the button, so it reads submitting === false and fires a
     second create() — a duplicate request for the same day. A ref flips
     synchronously, so the second click is dropped. */
  const inFlight = useRef(false);
  const [errors, setErrors]       = useState<Partial<Record<'reason' | 'punches', string>>>({});
  /* A request already live for this day. The server refuses a second one
     (AttendanceRegularizationController::store), but finding that out only on
     submit means retyping punches and a reason first. Looked up as the modal
     opens so the answer is on screen before any of that. null = still checking. */
  const [existing, setExisting] = useState<ApiRegularization | null | undefined>(undefined);

  /* Mirrors the server's shift bounding so the requester learns their 22:00 will
     be trimmed BEFORE they submit, rather than discovering it on the approved
     row. Falls back to the same 09:30–18:30 office default the backend uses when
     the employee's shift resolves to no timing. */
  const outOfShift = useMemo(() => {
    const sMin = toMinutes(shiftStart) ?? toMinutes('09:30')!;
    let eMin  = toMinutes(shiftEnd) ?? toMinutes('18:30')!;
    const crossesMidnight = eMin <= sMin;
    if (crossesMidnight) eMin += 1440;

    // Matches the server's nearestToWindow: on a night shift "05:00" is the
    // tail of the window while "21:00" is the hour before it — pick whichever
    // reading sits nearer, so the warning and the trim never disagree.
    const dist = (v: number) => (v < sMin ? sMin - v : v > eMin ? v - eMin : 0);
    const lift = (v: number) =>
      crossesMidnight && dist(v + 1440) < dist(v) ? v + 1440 : v;

    return punchEdits.some(e => {
      if (e.action === 'delete') return false;
      return [e.newIn, e.newOut].some(t => {
        const v = toMinutes(t);
        if (v === null) return false;
        const lifted = lift(v);
        return lifted < sMin || lifted > eMin;
      });
    });
  }, [punchEdits, shiftStart, shiftEnd]);

  /* Nothing has actually been changed.
   *
   * The form opens PREFILLED with the day's punches, so the untouched state is a
   * request whose "after" equals its "before". Those were accepted, routed and
   * approved, and the reviewer saw identical times on both rows with no way to
   * tell it from a real correction. Warned live here and refused on submit; the
   * server enforces the same rule so a direct POST can't slip past. (QA)
   *
   * The button is deliberately NOT disabled — this state is true the instant the
   * modal opens, and a Request button that starts greyed out reads as broken
   * rather than as "you haven't changed anything yet". */
  const unchanged = useMemo(() => {
    const sig = (edits: PunchEdit[]) => edits
      .filter(e => e.action !== 'delete' && e.newIn)
      .map(e => `${e.newIn}|${e.newOut || ''}`)
      .join(',');
    const before = sig(initialEdits);
    return before !== '' && before === sig(punchEdits);
  }, [initialEdits, punchEdits]);

  /* The same clock-in entered on two rows. Mirrors the server rule: keyed on
   * the IN time, compared as text so a night shift crossing midnight is safe.
   * Returns the offending time so the message can name it. */
  const duplicateIn = useMemo(() => {
    const seen = new Set<string>();
    for (const e of punchEdits) {
      if (e.action === 'delete') continue;
      const t = (e.newIn || '').trim();
      if (!t) continue;
      if (seen.has(t)) return t;
      seen.add(t);
    }
    return null;
  }, [punchEdits]);

  useEffect(() => { setPunchEdits(initialEdits); }, [initialEdits]);
  // Reset transient fields each time the modal (re)opens for a fresh day.
  useEffect(() => {
    if (!open) return;
    setReason('');
    setErrors({});

    /* Pending OR Approved blocks a new request; Rejected / Cancelled do not —
       being turned down is exactly when the day gets re-filed. Same rule as the
       server, so the two can't disagree. (QA #79) */
    let stale = false;
    setExisting(undefined);
    regularizationApi.list({ employee_id: employeeId })
      .then(rows => {
        if (stale) return;
        const day = (v: string) => (/^(d{4}-d{2}-d{2})/.exec(v || '')?.[1]) ?? '';
        const hit = rows.find(r => day(r.regularization_date) === day(dateIso)
          && (r.status === 'Pending' || r.status === 'Approved'));
        setExisting(hit ?? null);
      })
      // A failed lookup must not block filing — the server still guards it.
      .catch(() => { if (!stale) setExisting(null); });
    return () => { stale = true; };
  }, [open, dateIso, employeeId]);

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
    if (inFlight.current || submitting) return;
    if (existing) {
      toast.error('Already regularized', existing.status === 'Pending'
        ? 'A request for this date is already pending approval.'
        : 'This date has already been regularized and approved.');
      return;
    }
    const errs: typeof errors = {};
    if (unchanged) {
      setErrors({ punches: 'These are the same times already recorded for this day — change a punch to raise a correction.' });
      toast.error('Nothing to correct', 'The times you have entered match the day’s existing punches.');
      return;
    }
    if (!reason.trim()) errs.reason = 'Reason is required';
    const valid = punchEdits.some(e => e.action !== 'delete');
    const allOk = punchEdits.every(e =>
      e.action === 'delete' ||
      (e.newIn && /^\d{2}:\d{2}$/.test(e.newIn) && (!e.newOut || /^\d{2}:\d{2}$/.test(e.newOut)))
    );
    if (!valid) errs.punches = 'Add at least one punch entry';
    else if (!allOk) errs.punches = 'All punch entries need a valid HH:MM time';
    else if (duplicateIn) errs.punches = `Two rows both start at ${duplicateIn} — remove the duplicate or change its start time.`;
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Validation', 'Fix the highlighted fields');
      return;
    }
    setErrors({});

    const punches = punchEdits
      .filter(e => e.action !== 'delete' && e.newIn)
      .map(e => ({ in: e.newIn, out: e.newOut || null }));

    inFlight.current = true;
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
      // A trim is not a failure, but the requester must not believe times they
      // never got were recorded — say so instead of a bare success.
      if (row.shift_notice) {
        toast.warning('Times trimmed to shift', `${row.shift_notice} ${approverText}`);
      } else {
        toast.success('Submitted', approverText);
      }
      onSubmitted?.(row);
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Could not submit request';
      toast.error('Could not submit request', msg);
    } finally {
      inFlight.current = false;
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
                {duplicateIn && !errors.punches && (
                  <small className="att-reg-keka-error">
                    <i className="ri-error-warning-line me-1" />
                    Two rows both start at {duplicateIn} — remove the duplicate or change its start time.
                  </small>
                )}
                {unchanged && !duplicateIn && !errors.punches && (
                  <small className="att-reg-keka-error" style={{ color: '#d98c00' }}>
                    <i className="ri-error-warning-line me-1" />
                    These match the day’s existing punches — edit a time to raise a correction.
                  </small>
                )}
                {outOfShift && !unchanged && !duplicateIn && !errors.punches && (
                  <small className="att-reg-keka-error" style={{ color: '#d98c00' }}>
                    <i className="ri-error-warning-line me-1" />
                    Some times fall outside the shift{shiftStart && shiftEnd ? ` (${fmt12h(shiftStart)} - ${fmt12h(shiftEnd)})` : ''}.
                    Regularization can only correct hours within the shift — the extra time will be trimmed and will not be paid as overtime.
                  </small>
                )}
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

          {existing && (
            <div
              className="att-reg-keka-error d-flex align-items-start gap-2 mb-2"
              role="alert"
              style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 10px', color: '#b91c1c' }}
            >
              <i className="ri-error-warning-line" style={{ marginTop: 1 }} />
              <span>
                {existing.status === 'Pending'
                  ? 'A regularization request for this date is already pending approval. Act on that one before raising another.'
                  : 'This date has already been regularized and the correction was approved. Ask HR to reverse it before filing again.'}
              </span>
            </div>
          )}

          <div className="att-reg-keka-foot">
            <button type="button" className="att-reg-keka-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="att-reg-keka-submit" onClick={submit} disabled={submitting || !!existing} aria-busy={submitting}>
              {/* Spinner + label, so the in-flight state is legible at a glance
                  and not just a word swap on an otherwise identical button. */}
              {submitting && <span className="att-reg-keka-spin" aria-hidden="true" />}
              {submitting ? 'Submitting…' : 'Request'}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
