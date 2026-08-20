import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import Swal from 'sweetalert2';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { MasterDatePicker, MasterSelect } from '../master/masterFormKit';
import {
  employeeBalancesApi,
  leaveRequestsApi,
  ApiEmployeeBalanceType,
} from '../hrms/leavePlansApi';
import '../../../css/request-leave-drawer.css';

interface NotifyEmployee {
  id: number;
  name: string;
  emp_code: string;
  designation?: string | null;
  photo_url?: string | null;
}

interface Props {
  isOpen: boolean;
  employeeId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

function diffDaysInclusive(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from); const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return 0;
  return Math.round(ms / 86400000) + 1;
}

const fmtNiceDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const ACCENT_PALETTE = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accentFor = (id: number) => ACCENT_PALETTE[id % ACCENT_PALETTE.length];
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

export default function RequestLeaveModal({ isOpen, employeeId, onClose, onSubmitted }: Props) {
  const toast = useToast();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState<string>('');
  // Full day vs. Custom (half day). Half-day only applies to a single date and
  // maps to the backend day_type first_half / second_half.
  const [dayMode, setDayMode] = useState<'full' | 'custom'>('full');
  const [halfType, setHalfType] = useState<'first_half' | 'second_half'>('first_half');
  const [note, setNote] = useState('');
  const [notifySearch, setNotifySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [notifyOptions, setNotifyOptions] = useState<NotifyEmployee[]>([]);
  const [selectedNotify, setSelectedNotify] = useState<NotifyEmployee[]>([]);
  const [balanceTypes, setBalanceTypes] = useState<ApiEmployeeBalanceType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const notifyBoxRef = useRef<HTMLDivElement | null>(null);
  /* The picker is a dropdown: closed until the field is used, so the form does
     not carry a permanently open list of colleagues under it. */
  const [notifyOpen, setNotifyOpen] = useState(false);

  useEffect(() => {
    if (!notifyOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      if (!notifyBoxRef.current?.contains(ev.target as Node)) setNotifyOpen(false);
    };
    const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setNotifyOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [notifyOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setFromDate(''); setToDate('');
    setLeaveTypeId('');
    setDayMode('full'); setHalfType('first_half');
    setNote('');
    setNotifySearch(''); setDebouncedSearch('');
    setNotifyOptions([]); setSelectedNotify([]); setNotifyOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const empId = Number(employeeId);
    if (!Number.isFinite(empId) || empId <= 0) return;
    employeeBalancesApi.fetch(empId)
      .then(resp => setBalanceTypes(resp.types))
      .catch(err => console.warn('[RequestLeaveModal] balance fetch failed', err));
  }, [isOpen, employeeId]);

  useEffect(() => {
    // Show the spinner from the first keystroke, not from the fetch — the
    // 300ms debounce is otherwise dead air with stale results on screen.
    if (notifyOpen && notifySearch.trim()) setSearchLoading(true);
    const t = setTimeout(() => setDebouncedSearch(notifySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [notifySearch]);

  const [searchError, setSearchError] = useState<string | null>(null);
  /* Distinct from "no results": between the keystroke and the response there
     was NO signal at all, so an empty dropdown read as "nobody matches" while
     the request was still in flight (CBC #123). */
  const [searchLoading, setSearchLoading] = useState(false);
  useEffect(() => {
    if (!notifyOpen) { setSearchLoading(false); return; }
    let alive = true;
    setSearchError(null);
    setSearchLoading(true);
    api.get('/leave-requests/colleagues', { params: { search: debouncedSearch, limit: 12, employee_id: employeeId } })
      .then(r => {
        if (!alive) return;
        const raw = r.data?.data ?? [];
        const list: NotifyEmployee[] = (Array.isArray(raw) ? raw : [])
          // Never let the applicant notify themselves — backend already excludes
          // them, but guard here too in case an admin flow omits the id.
          .filter((e: any) => Number(e.id) !== Number(employeeId))
          .map((e: any) => ({
            id: e.id,
            name: e.name || `Employee #${e.id}`,
            emp_code: e.emp_code || `EMP-${e.id}`,
            designation: e.designation || null,
            photo_url: e.photo_url || null,
          }));
        setNotifyOptions(list);
      })
      .catch(err => {
        if (!alive) return;
        const msg = err?.response?.data?.message || err?.message || 'Search failed';
        setSearchError(msg);
        setNotifyOptions([]);
      })
      // Cleared however the request ends. A spinner that survives a failure is
      // worse than none — it never resolves and the user waits forever.
      .finally(() => { if (alive) setSearchLoading(false); });
    return () => { alive = false; };
  }, [notifyOpen, debouncedSearch, employeeId]);

  // Half-day is only meaningful on a single calendar day (matches the backend
  // rule) AND only for leave types whose setup enables "Allow half day leave".
  const selectedBalanceType = balanceTypes.find(t => String(t.leave_type_id) === String(leaveTypeId));
  const allowHalf = !!selectedBalanceType?.allow_half_day;
  const singleDay = !!fromDate && fromDate === toDate;
  const isHalf = dayMode === 'custom' && singleDay && allowHalf;

  // If the chosen leave type doesn't allow half days, snap back to Full day.
  useEffect(() => {
    if (!allowHalf && dayMode === 'custom') setDayMode('full');
  }, [allowHalf, dayMode]);
  const totalDays = useMemo(
    () => (isHalf ? 0.5 : diffDaysInclusive(fromDate, toDate)),
    [isHalf, fromDate, toDate],
  );

  // If the picked range stops being a single day, snap back to Full day so a
  // stale "Custom" half-day selection can't ride along on a multi-day request.
  useEffect(() => {
    if (!singleDay && dayMode === 'custom') setDayMode('full');
  }, [singleDay, dayMode]);

  const { user } = useAuth();
  // Admins (client/super) may file a genuine same-day absence on behalf of an
  // employee, exactly as the backend allows. Self-service employees cannot.
  const isAdmin = user?.user_type === 'client_admin' || user?.user_type === 'super_admin';

  const today = new Date().toISOString().slice(0, 10);
  // Today is now selectable for everyone — but for a self-service employee,
  // applying for TODAY is restricted to the SECOND HALF only (the morning is
  // already underway). Mirrors the backend rule in LeaveRequestController::store.
  const minStartDate = today;
  // Self-service employee picking today → must be a single second-half day.
  const isToday = !isAdmin && !!fromDate && fromDate === today;

  // Force today's leave to Custom · Second Half (the only allowed shape) — but
  // only when the leave type permits half days.
  useEffect(() => {
    if (isToday && allowHalf) { setDayMode('custom'); setHalfType('second_half'); }
  }, [isToday, allowHalf]);

  const isSelected = useCallback(
    (id: number) => selectedNotify.some(s => s.id === id),
    [selectedNotify],
  );

  const toggleNotify = (e: NotifyEmployee) => {
    setSelectedNotify(prev => prev.some(s => s.id === e.id) ? prev.filter(s => s.id !== e.id) : [...prev, e]);
  };
  const removeNotify = (id: number) => setSelectedNotify(prev => prev.filter(s => s.id !== id));

  /* Whether the form is COMPLETE — used for the button's tone, not to block
     the click. A disabled button cannot tell you why it is disabled. */
  const isComplete = !!fromDate && !!toDate && !!leaveTypeId;

  const submit = async () => {
    if (submitting) return;

    /* Name the first missing field rather than doing nothing (CBC #112).
       Ordered the way the form reads, so the message points at the first gap
       the user would meet on their way down. */
    if (!fromDate || !toDate) {
      await Swal.fire({
        title: 'Select the leave dates',
        text: 'Choose both a From and a To date before requesting leave.',
        icon: 'warning', confirmButtonText: 'OK', confirmButtonColor: '#f06548',
      });
      return;
    }
    if (!leaveTypeId) {
      await Swal.fire({
        title: 'Please select a leave type',
        text: balanceTypes.length === 0
          ? 'No leave types are available to you yet — ask HR to add you to a leave plan.'
          : 'Leave Type is required. Pick the type of leave you are applying for.',
        icon: 'warning', confirmButtonText: 'OK', confirmButtonColor: '#f06548',
      });
      return;
    }
    // Past guard — leave can't start before today.
    if (fromDate < minStartDate) {
      await Swal.fire({
        title: 'Invalid date',
        text: 'Leave cannot be applied for a past date.',
        icon: 'warning',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f06548',
      });
      return;
    }
    // Today needs a second-half (half-day) request — so a type that doesn't
    // allow half days can't be applied for today at all.
    if (isToday && !allowHalf) {
      await Swal.fire({
        title: 'Not allowed for today',
        text: 'This leave type cannot be applied for today (it does not allow half-day leave). Please pick a date from tomorrow onward.',
        icon: 'warning',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f06548',
      });
      return;
    }
    // Same-day rule — applying for TODAY is allowed only for the second half.
    if (isToday && !(dayMode === 'custom' && halfType === 'second_half')) {
      await Swal.fire({
        title: 'Second half only',
        text: 'Leave for today can only be applied for the second half of the day.',
        icon: 'warning',
        confirmButtonText: 'OK',
        confirmButtonColor: '#f06548',
      });
      return;
    }
    const selectedBalance = balanceTypes.find(t => String(t.leave_type_id) === String(leaveTypeId));
    if (selectedBalance && !selectedBalance.unlimited) {
      const remaining = selectedBalance.available ?? 0;
      if (totalDays > remaining) {
        await Swal.fire({
          title: remaining <= 0 ? `No ${selectedBalance.name} balance available` : 'Not enough leave balance',
          text: remaining <= 0
            ? `You have no ${selectedBalance.name} balance left, so this request can't be submitted.`
            : `${selectedBalance.name} has ${remaining} day${remaining === 1 ? '' : 's'} available but you requested ${totalDays}.`,
          icon: 'warning',
          confirmButtonText: 'OK',
          confirmButtonColor: '#f06548',
        });
        return;
      }
    }
    setSubmitting(true);
    try {
      await leaveRequestsApi.create({
        employee_id: Number(employeeId) || undefined,
        leave_type_id: Number(leaveTypeId),
        from_date: fromDate,
        to_date: toDate,
        day_type: isHalf ? halfType : 'full',
        reason: note || undefined,
        notify: { employee_ids: selectedNotify.map(s => s.id) },
      });
      onSubmitted();
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
      isOpen={isOpen}
      toggle={onClose}
      backdrop="static"
      zIndex={2100}
      modalClassName="lvr-drawer-modal"
      contentClassName="lvr-drawer-content"
      backdropClassName="lvr-drawer-backdrop"
      fade
    >
      <ModalBody className="p-0 d-flex flex-column h-100">
        <div className="lvr-header">
          <div className="d-flex align-items-center gap-3">
            <span className="lvr-header-icon">
              <i className="ri-calendar-2-line" />
            </span>
            <div>
              <h5 className="fw-bold mb-0 text-white" style={{ fontSize: 16 }}>Request Leave</h5>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                File a new leave application
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="lvr-close-btn"
          >
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="lvr-body">
          <div className="lvr-section">
            <div className="lvr-section-title">
              <i className="ri-calendar-line" />
              <span>Leave Dates</span><span className="lvr-req" aria-hidden="true">*</span>
            </div>
            <div className="lvr-date-strip">
              <div className="lvr-date-cell">
                <label className="lvr-mini-label">From<span className="lvr-req" aria-hidden="true">*</span></label>
                <MasterDatePicker
                  value={fromDate}
                  onChange={(v) => {
                    setFromDate(v);
                    if (toDate && new Date(toDate) < new Date(v)) setToDate(v);
                  }}
                  minDate={minStartDate}
                  placeholder="Select date"
                />
              </div>
              <div className="lvr-days-pill">
                <div className="fw-bold" style={{ fontSize: 18, lineHeight: 1 }}>{totalDays}</div>
                <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>
                  {totalDays === 1 ? 'day' : 'days'}
                </div>
              </div>
              <div className="lvr-date-cell">
                <label className="lvr-mini-label">To<span className="lvr-req" aria-hidden="true">*</span></label>
                <MasterDatePicker
                  value={toDate}
                  onChange={setToDate}
                  minDate={fromDate || minStartDate}
                  placeholder="Select date"
                />
              </div>
            </div>
          </div>

          <div className="lvr-section">
            <div className="lvr-section-title">
              <i className="ri-bookmark-line" />
              <span>Leave Type</span><span className="lvr-req" aria-hidden="true">*</span>
            </div>
            {balanceTypes.length === 0 ? (
              <div className="lvr-warning">
                <i className="ri-information-line" />
                <span>No leave plan / types assigned yet. Ask HR to add you to a plan.</span>
              </div>
            ) : (
              <MasterSelect
                value={leaveTypeId}
                onChange={(v) => setLeaveTypeId(String(v))}
                placeholder="Select a leave type…"
                options={balanceTypes.map(t => ({
                  value: String(t.leave_type_id),
                  label: `${t.name} — ${t.unlimited ? 'Unlimited days available' : `${t.available ?? 0} days available`}`,
                }))}
              />
            )}
          </div>

          {fromDate && toDate && (
            <div className="lvr-section">
              <div className="lvr-section-title">
                <i className="ri-time-line" />
                <span>Duration</span>
              </div>
              <div
                className="d-inline-flex"
                role="group"
                style={{ border: '1px solid var(--vz-border-color)', borderRadius: 8, overflow: 'hidden', background: 'var(--vz-light, #f1f3f6)' }}
              >
                <button
                  type="button"
                  onClick={() => { if (!isToday) setDayMode('full'); }}
                  disabled={isToday}
                  aria-pressed={dayMode === 'full'}
                  title={isToday ? 'Leave for today can only be the second half' : undefined}
                  style={{
                    padding: '6px 18px', border: 'none', fontWeight: 600, fontSize: 13,
                    cursor: isToday ? 'not-allowed' : 'pointer',
                    background: dayMode === 'full' ? '#fff' : 'transparent',
                    color: isToday ? '#aab2bd' : dayMode === 'full' ? '#212529' : '#6b7280',
                    boxShadow: dayMode === 'full' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  Full day
                </button>
                <button
                  type="button"
                  onClick={() => { if (singleDay && allowHalf) setDayMode('custom'); }}
                  disabled={!singleDay || !allowHalf}
                  aria-pressed={dayMode === 'custom'}
                  title={!allowHalf ? 'This leave type does not allow half-day leave' : !singleDay ? 'Half day applies to a single date only' : undefined}
                  style={{
                    padding: '6px 18px', border: 'none', fontWeight: 600, fontSize: 13,
                    cursor: (singleDay && allowHalf) ? 'pointer' : 'not-allowed',
                    background: dayMode === 'custom' ? '#fff' : 'transparent',
                    color: (!singleDay || !allowHalf) ? '#aab2bd' : dayMode === 'custom' ? '#212529' : '#6b7280',
                    boxShadow: dayMode === 'custom' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                  }}
                >
                  Custom
                </button>
              </div>

              {isHalf && (
                <div className="mt-2">
                  <div className="text-muted mb-1" style={{ fontSize: 12 }}>On {fmtNiceDate(fromDate)}</div>
                  <select
                    className="lvr-input"
                    value={halfType}
                    onChange={e => setHalfType(e.target.value as 'first_half' | 'second_half')}
                    style={{ maxWidth: 240 }}
                  >
                    {/* Today can only be the second half — first half is past. */}
                    <option value="first_half" disabled={isToday}>First Half</option>
                    <option value="second_half">Second Half</option>
                  </select>
                  {isToday && (
                    <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>
                      <i className="ri-information-line me-1" />
                      Leave for today can only be applied for the second half.
                    </div>
                  )}
                </div>
              )}

              <div className="text-muted mt-2 d-flex align-items-center gap-1" style={{ fontSize: 12.5 }}>
                <i className="ri-time-line" />
                You are requesting for <strong>{totalDays} {totalDays === 1 ? 'day' : 'days'}</strong> of leave
              </div>
            </div>
          )}

          <div className="lvr-section">
            <div className="lvr-section-title">
              <i className="ri-edit-2-line" />
              <span>Note</span>
            </div>
            <textarea
              className="lvr-input lvr-textarea"
              rows={3}
              placeholder="Share the reason for your leave (optional)…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          <div className="lvr-section">
            <div className="lvr-section-title">
              <i className="ri-user-shared-line" />
              <span>Notify Colleagues</span>
              {selectedNotify.length > 0 && (
                <span className="lvr-count-pill">{selectedNotify.length}</span>
              )}
            </div>

            {selectedNotify.length > 0 && (
              <div className="lvr-chip-row">
                {selectedNotify.map(e => (
                  <span key={e.id} className="lvr-chip">
                    {e.photo_url ? (
                      <img src={e.photo_url} alt={e.name} className="lvr-chip-avatar" />
                    ) : (
                      <span
                        className="lvr-chip-avatar lvr-chip-avatar-letter"
                        style={{ background: `linear-gradient(135deg, ${accentFor(e.id)}, ${accentFor(e.id)}cc)` }}
                      >
                        {initialsOf(e.name)}
                      </span>
                    )}
                    <span className="lvr-chip-text">{e.name}</span>
                    <button
                      type="button"
                      onClick={() => removeNotify(e.id)}
                      className="lvr-chip-x"
                      aria-label={`Remove ${e.name}`}
                    >
                      <i className="ri-close-line" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="lvr-notify-dd" ref={notifyBoxRef}>
              <div className="lvr-search-wrap">
                <i className="ri-search-line lvr-search-icon" />
                <input
                  type="text"
                  className="lvr-input lvr-search-input"
                  placeholder="Search employees by name or code…"
                  value={notifySearch}
                  onChange={e => { setNotifySearch(e.target.value); setNotifyOpen(true); }}
                  onFocus={() => setNotifyOpen(true)}
                  role="combobox"
                  aria-expanded={notifyOpen}
                  aria-controls="lvr-notify-panel"
                />
                {/* Feedback sits in the field, where the user is looking. */}
                {searchLoading
                  ? <i className="ri-loader-4-line lvr-search-spinner" aria-hidden="true" />
                  : <i
                      className={`ri-arrow-down-s-line lvr-search-caret${notifyOpen ? ' is-open' : ''}`}
                      aria-hidden="true"
                      onMouseDown={ev => { ev.preventDefault(); setNotifyOpen(o => !o); }}
                    />}
              </div>

              {notifyOpen && (
                <div className="lvr-notify-panel" id="lvr-notify-panel" role="listbox" aria-multiselectable="true">
                  {searchLoading && (
                    <div className="lvr-search-loading" role="status" aria-live="polite">
                      <i className="ri-loader-4-line" />
                      <span>Searching employees…</span>
                    </div>
                  )}

                  {!searchLoading && searchError && (
                    <div className="lvr-empty-search">
                      <i className="ri-error-warning-line" />
                      <span>{searchError}</span>
                    </div>
                  )}

                  {!searchLoading && !searchError && notifyOptions.length > 0 && (
                    <div className="lvr-notify-list">
                      {notifyOptions.map(e => {
                        const checked = isSelected(e.id);
                        return (
                          <label
                            key={e.id}
                            className={`lvr-notify-row ${checked ? 'is-selected' : ''}`}
                            role="option"
                            aria-selected={checked}
                          >
                            <input
                              type="checkbox"
                              className="lvr-notify-check"
                              checked={checked}
                              onChange={() => toggleNotify(e)}
                            />
                            {e.photo_url ? (
                              <img src={e.photo_url} alt={e.name} className="lvr-notify-avatar" />
                            ) : (
                              <span
                                className="lvr-notify-avatar lvr-notify-avatar-letter"
                                style={{ background: `linear-gradient(135deg, ${accentFor(e.id)}, ${accentFor(e.id)}cc)` }}
                              >
                                {initialsOf(e.name)}
                              </span>
                            )}
                            <div className="lvr-notify-meta">
                              <div className="lvr-notify-name">{e.name}</div>
                              {e.designation && (
                                <div className="lvr-notify-sub">{e.designation}</div>
                              )}
                              <div className="lvr-notify-code">
                                Employee Number: {e.emp_code}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {!searchLoading && !searchError && notifyOptions.length === 0 && (
                    <div className="lvr-empty-search">
                      <i className="ri-search-eye-line" />
                      <span>
                        {debouncedSearch
                          ? `No employees matched "${debouncedSearch}".`
                          : 'No colleagues available to notify.'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {searchError && (
              <div className="lvr-warning" style={{ marginTop: 8 }}>
                <i className="ri-error-warning-line" />
                <span>Search failed: {searchError}</span>
              </div>
            )}
          </div>
        </div>

        <div className="lvr-footer">
          <button type="button" className="lvr-btn-ghost" onClick={onClose}>
            <i className="ri-close-line" /> Cancel
          </button>
          <button
            type="button"
            className="lvr-btn-primary"
            onClick={submit}
            // Only the in-flight state blocks the click — an incomplete form
            // gets an explanation from submit() instead of silence.
            disabled={submitting}
            aria-disabled={!isComplete}
          >
            {submitting ? <><i className="ri-loader-4-line ri-spin" /> Submitting…</> : <><i className="ri-send-plane-2-line" /> Request</>}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}
