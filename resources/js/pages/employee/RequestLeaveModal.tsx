import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../../api';
import { MasterDatePicker } from '../master/masterFormKit';
import {
  employeeBalancesApi,
  leaveRequestsApi,
  ApiEmployeeBalanceType,
} from '../hrms/leavePlansApi';
import '../../../css/request-leave-drawer.css';

// ─────────────────────────────────────────────────────────────────────────────
// RequestLeaveModal — Keka-style right-side drawer. Sits on top of the
// EmployeeProfile fullscreen overlay (z-index 1080) via zIndex={2100}.
//
// Layout:
//   - Header: gradient strip, leave icon, title + subtitle, X close button
//   - From / To date strip using MasterDatePicker for proper calendar UX
//   - Leave type dropdown showing "N days available" per option
//   - Note textarea
//   - Notify list — searchable employee chooser with checkbox rows
//     showing avatar / designation / emp_code. Selected colleagues
//     render as removable chips above the search.
//   - Footer: Cancel + Request buttons
// ─────────────────────────────────────────────────────────────────────────────
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

const ACCENT_PALETTE = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e'];
const accentFor = (id: number) => ACCENT_PALETTE[id % ACCENT_PALETTE.length];
const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase() || '?';

export default function RequestLeaveModal({ isOpen, employeeId, onClose, onSubmitted }: Props) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState<string>('');
  const [note, setNote] = useState('');
  const [notifySearch, setNotifySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [notifyOptions, setNotifyOptions] = useState<NotifyEmployee[]>([]);
  const [selectedNotify, setSelectedNotify] = useState<NotifyEmployee[]>([]);
  const [balanceTypes, setBalanceTypes] = useState<ApiEmployeeBalanceType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const notifyBoxRef = useRef<HTMLDivElement | null>(null);

  // Reset when the modal opens (preserve nothing across cycles).
  useEffect(() => {
    if (!isOpen) return;
    setFromDate(''); setToDate('');
    setLeaveTypeId('');
    setNote('');
    setNotifySearch(''); setDebouncedSearch('');
    setNotifyOptions([]); setSelectedNotify([]);
  }, [isOpen]);

  // Pull this employee's balance summary so the type dropdown can show
  // "Paid Leave — 6 days available".
  useEffect(() => {
    if (!isOpen) return;
    const empId = Number(employeeId);
    if (!Number.isFinite(empId) || empId <= 0) return;
    employeeBalancesApi.fetch(empId)
      .then(resp => setBalanceTypes(resp.types))
      .catch(err => console.warn('[RequestLeaveModal] balance fetch failed', err));
  }, [isOpen, employeeId]);

  // Debounced notify search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(notifySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [notifySearch]);

  // Search is "open" whenever the user has typed something. Hits the
  // dedicated /api/leave-requests/colleagues endpoint — open to every
  // authed user (the main /api/employees needs HR permission so a
  // regular employee filing leave gets a silent 403 there).
  const [searchError, setSearchError] = useState<string | null>(null);
  useEffect(() => {
    if (!debouncedSearch) { setNotifyOptions([]); setSearchError(null); return; }
    let alive = true;
    setSearchError(null);
    api.get('/leave-requests/colleagues', { params: { search: debouncedSearch, limit: 12 } })
      .then(r => {
        if (!alive) return;
        const raw = r.data?.data ?? [];
        const list: NotifyEmployee[] = (Array.isArray(raw) ? raw : []).map((e: any) => ({
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
        // Surface the failure inline so future API changes don't go
        // unnoticed (the previous swallow-and-show-blank UX was the
        // exact reason the empty-list bug hid for so long).
        const msg = err?.response?.data?.message || err?.message || 'Search failed';
        setSearchError(msg);
        setNotifyOptions([]);
      });
    return () => { alive = false; };
  }, [debouncedSearch]);

  const totalDays = useMemo(() => diffDaysInclusive(fromDate, toDate), [fromDate, toDate]);

  const isSelected = useCallback(
    (id: number) => selectedNotify.some(s => s.id === id),
    [selectedNotify],
  );

  const toggleNotify = (e: NotifyEmployee) => {
    setSelectedNotify(prev => prev.some(s => s.id === e.id) ? prev.filter(s => s.id !== e.id) : [...prev, e]);
  };
  const removeNotify = (id: number) => setSelectedNotify(prev => prev.filter(s => s.id !== id));

  const canSubmit = !!fromDate && !!toDate && !!leaveTypeId && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    // Client-side balance guard. The backend will accept-and-create with
    // an over-balance request today; surfacing the failure here saves a
    // round-trip and keeps the user on the form for a quick edit.
    // Skipped for "unlimited" types since they have no quota cap.
    const selectedBalance = balanceTypes.find(t => String(t.leave_type_id) === String(leaveTypeId));
    if (selectedBalance && !selectedBalance.unlimited) {
      const remaining = selectedBalance.available ?? 0;
      if (totalDays > remaining) {
        alert(`Not enough balance — ${selectedBalance.name} has ${remaining} days available but you requested ${totalDays}.`);
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
        day_type: 'full',
        reason: note || undefined,
        notify: { employee_ids: selectedNotify.map(s => s.id) },
      });
      onSubmitted();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Could not submit request';
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      backdrop="static"
      // zIndex prop is required — reactstrap sets z-index as an inline
      // style on the outer wrapper (default 1050). EmployeeProfile's
      // fullscreen overlay sits at 1080, so we need at least 2100 here.
      zIndex={2100}
      // Custom class flips the modal into a right-side drawer (see CSS
      // .lvr-drawer-modal in resources/css/leave.css).
      modalClassName="lvr-drawer-modal"
      contentClassName="lvr-drawer-content"
      backdropClassName="lvr-drawer-backdrop"
      fade
    >
      <ModalBody className="p-0 d-flex flex-column h-100">
        {/* Header — gradient strip with leave icon */}
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

        {/* Scrollable body */}
        <div className="lvr-body">
          {/* ── Section: Dates ── */}
          <div className="lvr-section">
            <div className="lvr-section-title">
              <i className="ri-calendar-line" />
              <span>Leave Dates</span>
            </div>
            <div className="lvr-date-strip">
              <div className="lvr-date-cell">
                <label className="lvr-mini-label">From</label>
                <MasterDatePicker
                  value={fromDate}
                  onChange={(v) => {
                    setFromDate(v);
                    if (toDate && new Date(toDate) < new Date(v)) setToDate(v);
                  }}
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
                <label className="lvr-mini-label">To</label>
                <MasterDatePicker
                  value={toDate}
                  onChange={setToDate}
                  minDate={fromDate || undefined}
                  placeholder="Select date"
                />
              </div>
            </div>
          </div>

          {/* ── Section: Leave Type ── */}
          <div className="lvr-section">
            <div className="lvr-section-title">
              <i className="ri-bookmark-line" />
              <span>Leave Type</span>
            </div>
            {balanceTypes.length === 0 ? (
              <div className="lvr-warning">
                <i className="ri-information-line" />
                <span>No leave plan / types assigned yet. Ask HR to add you to a plan.</span>
              </div>
            ) : (
              <select
                className="lvr-input"
                value={leaveTypeId}
                onChange={e => setLeaveTypeId(e.target.value)}
              >
                <option value="">Select a leave type…</option>
                {balanceTypes.map(t => {
                  const avail = t.unlimited ? '∞' : (t.available ?? 0);
                  return (
                    <option key={t.leave_type_id} value={String(t.leave_type_id)}>
                      {t.name} — {avail} days available
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* ── Section: Note ── */}
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

          {/* ── Section: Notify colleagues ── */}
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

            <div className="lvr-search-wrap" ref={notifyBoxRef}>
              <i className="ri-search-line lvr-search-icon" />
              <input
                type="text"
                className="lvr-input lvr-search-input"
                placeholder="Search employees by name or code…"
                value={notifySearch}
                onChange={e => setNotifySearch(e.target.value)}
              />
            </div>

            {/* Inline checkbox list. Always shown when there are search
                results; expanded layout (vs. dropdown) makes it easier
                to scan multiple matches in a drawer width. */}
            {notifyOptions.length > 0 && (
              <div className="lvr-notify-list">
                {notifyOptions.map(e => {
                  const checked = isSelected(e.id);
                  return (
                    <label
                      key={e.id}
                      className={`lvr-notify-row ${checked ? 'is-selected' : ''}`}
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

            {!notifyOptions.length && debouncedSearch && !searchError && (
              <div className="lvr-empty-search">
                <i className="ri-search-eye-line" />
                <span>No employees matched "{debouncedSearch}".</span>
              </div>
            )}
            {searchError && (
              <div className="lvr-warning" style={{ marginTop: 8 }}>
                <i className="ri-error-warning-line" />
                <span>Search failed: {searchError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer — sticky bottom */}
        <div className="lvr-footer">
          <button type="button" className="lvr-btn-ghost" onClick={onClose}>
            <i className="ri-close-line" /> Cancel
          </button>
          <button
            type="button"
            className="lvr-btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting ? <><i className="ri-loader-4-line ri-spin" /> Submitting…</> : <><i className="ri-send-plane-2-line" /> Request</>}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}
