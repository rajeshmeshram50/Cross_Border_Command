import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody } from 'reactstrap';
import api from '../../api';
import {
  employeeBalancesApi,
  leaveRequestsApi,
  ApiEmployeeBalanceType,
} from '../hrms/leavePlansApi';

// ─────────────────────────────────────────────────────────────────────────────
// RequestLeaveModal — Keka-style compact "Request Leave" form. Drops the
// heavy 7-stage wizard for a single focused modal with:
//   - From / To date strip with auto-computed day count
//   - Leave type dropdown showing "N days available" per option
//   - Note textarea
//   - Notify field that searches employees by name / emp_code and lets
//     the requester pick one or more colleagues to CC
//   - Submit posts to /api/leave-requests; parent refetches on success
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
  employeeId: string;            // the requester (parent's employee record id)
  onClose: () => void;
  onSubmitted: () => void;       // parent should refetch lists on success
}

function diffDaysInclusive(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from); const b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  const ms = b.getTime() - a.getTime();
  if (ms < 0) return 0;
  return Math.round(ms / 86400000) + 1;
}

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
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Reset when the modal closes/opens
  useEffect(() => {
    if (!isOpen) return;
    setFromDate(''); setToDate('');
    setLeaveTypeId('');
    setNote('');
    setNotifySearch(''); setDebouncedSearch('');
    setNotifyOptions([]); setSelectedNotify([]);
    setShowSuggestions(false);
  }, [isOpen]);

  // Pull this employee's balance summary so the type dropdown can show
  // "Paid Leave — 6 days available". We don't want stale options, so
  // refetch every time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    const empId = Number(employeeId);
    if (!Number.isFinite(empId) || empId <= 0) return;
    employeeBalancesApi.fetch(empId)
      .then(resp => setBalanceTypes(resp.types))
      .catch(err => console.warn('[RequestLeaveModal] balance fetch failed', err));
  }, [isOpen, employeeId]);

  // Debounce the notify search 300ms — typing is fast, the network is not.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(notifySearch.trim()), 300);
    return () => clearTimeout(t);
  }, [notifySearch]);

  // Hit /api/employees with the debounced search. Skip empty queries —
  // we don't want to show the whole employee list as a dropdown.
  useEffect(() => {
    if (!debouncedSearch) { setNotifyOptions([]); return; }
    let alive = true;
    api.get('/employees', { params: { search: debouncedSearch, per_page: 8 } })
      .then(r => {
        if (!alive) return;
        const raw = r.data?.data ?? r.data ?? [];
        const list: NotifyEmployee[] = (Array.isArray(raw) ? raw : []).slice(0, 8).map((e: any) => ({
          id: e.id,
          name: e.display_name?.trim() || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || `Employee #${e.id}`,
          emp_code: e.emp_code || `EMP-${e.id}`,
          designation: e.designation?.name || e.designation_name || null,
          photo_url: e.profile_photo_url || e.photo_url || null,
        }));
        setNotifyOptions(list);
      })
      .catch(() => { /* silent — dropdown just stays empty */ });
    return () => { alive = false; };
  }, [debouncedSearch]);

  const totalDays = useMemo(() => diffDaysInclusive(fromDate, toDate), [fromDate, toDate]);

  const pickType = useCallback((id: string) => setLeaveTypeId(id), []);

  const pickNotify = (e: NotifyEmployee) => {
    if (selectedNotify.find(s => s.id === e.id)) return;
    setSelectedNotify(prev => [...prev, e]);
    setNotifySearch('');
    setShowSuggestions(false);
  };

  const removeNotify = (id: number) => {
    setSelectedNotify(prev => prev.filter(s => s.id !== id));
  };

  const canSubmit = !!fromDate && !!toDate && !!leaveTypeId && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
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
      centered
      size="md"
      backdrop="static"
      // Reactstrap sets z-index INLINE on its outer wrapper from the
      // `zIndex` prop (default 1050). CSS classes can't override that
      // inline style, so a `modalClassName` alone leaves the wrapper at
      // 1050 — below EmployeeProfile's .ep-fullscreen-overlay (z:1080)
      // and the modal opens invisible. Pass zIndex={2100} so the
      // wrapper inline style paints above the overlay.
      zIndex={2100}
      modalClassName="ep-leave-modal"
      backdropClassName="ep-leave-backdrop"
    >
      <ModalBody className="p-0">
        {/* Header */}
        <div className="d-flex align-items-center justify-content-between" style={{ padding: '18px 22px 14px', borderBottom: '1px solid #e5e7eb' }}>
          <h5 className="fw-bold mb-0" style={{ fontSize: 18 }}>Request Leave</h5>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
        </div>

        <div style={{ padding: '20px 22px' }}>
          {/* From / Days / To strip */}
          <div className="d-flex align-items-center gap-2 mb-3" style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
            <div className="flex-grow-1">
              <div className="text-muted" style={{ fontSize: 11 }}>From</div>
              <input
                type="date"
                className="form-control border-0 p-0 fw-bold"
                style={{ fontSize: 14, boxShadow: 'none' }}
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  if (toDate && new Date(toDate) < new Date(e.target.value)) setToDate(e.target.value);
                }}
              />
            </div>
            <div className="text-center px-3 py-2" style={{ background: '#f3f4f6', borderRadius: 8, minWidth: 70 }}>
              <div className="fw-bold" style={{ fontSize: 14 }}>{totalDays}</div>
              <div className="text-muted" style={{ fontSize: 10 }}>{totalDays === 1 ? 'day' : 'days'}</div>
            </div>
            <div className="flex-grow-1 text-end">
              <div className="text-muted" style={{ fontSize: 11 }}>To</div>
              <input
                type="date"
                className="form-control border-0 p-0 fw-bold text-end"
                style={{ fontSize: 14, boxShadow: 'none' }}
                value={toDate}
                min={fromDate || undefined}
                onChange={e => setToDate(e.target.value)}
              />
            </div>
          </div>

          {/* Leave type dropdown with balance */}
          <label className="fw-semibold mb-2" style={{ fontSize: 13 }}>Select type of leave you want to apply</label>
          {balanceTypes.length === 0 ? (
            <div className="text-muted mb-3" style={{ fontSize: 12, padding: 10, background: '#fef3c7', borderRadius: 8 }}>
              <i className="ri-information-line me-1" />
              No leave plan / types assigned yet. Ask HR to add you to a plan.
            </div>
          ) : (
            <div className="position-relative mb-3">
              <select
                className="form-select"
                value={leaveTypeId}
                onChange={e => pickType(e.target.value)}
              >
                <option value="">Select</option>
                {balanceTypes.map(t => {
                  const avail = t.unlimited ? '∞' : (t.available ?? 0);
                  return (
                    <option key={t.leave_type_id} value={String(t.leave_type_id)}>
                      {t.name} — {avail} days available
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Note */}
          <label className="fw-semibold mb-2" style={{ fontSize: 13 }}>Note</label>
          <textarea
            className="form-control mb-3"
            rows={3}
            placeholder="Type here"
            value={note}
            onChange={e => setNote(e.target.value)}
            style={{ fontSize: 13 }}
          />

          {/* Notify (employee search + chips) */}
          <label className="fw-semibold mb-2" style={{ fontSize: 13 }}>Notify</label>
          {selectedNotify.length > 0 && (
            <div className="d-flex gap-2 flex-wrap mb-2">
              {selectedNotify.map(e => (
                <span key={e.id} className="d-inline-flex align-items-center gap-1 rec-pill" style={{
                  background: '#ede9fe', color: '#5a3fd1', fontSize: 11, padding: '4px 10px',
                }}>
                  {e.name}
                  <button
                    type="button"
                    onClick={() => removeNotify(e.id)}
                    className="btn p-0"
                    style={{ fontSize: 12, color: '#5a3fd1', lineHeight: 1, marginLeft: 4 }}
                    aria-label={`Remove ${e.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="position-relative">
            <input
              type="text"
              className="form-control"
              placeholder="Search employee"
              value={notifySearch}
              onChange={e => { setNotifySearch(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              style={{ fontSize: 13 }}
            />
            {showSuggestions && notifyOptions.length > 0 && (
              <div className="position-absolute w-100 shadow-sm" style={{
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginTop: 4,
                zIndex: 100, maxHeight: 280, overflowY: 'auto',
              }}>
                {notifyOptions.map(e => {
                  const initials = e.name.split(/\s+/).filter(Boolean).map(s => s[0]).join('').slice(0, 2).toUpperCase();
                  const accent = '#0ab39c';
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className="d-flex align-items-center gap-2 w-100 text-start"
                      onMouseDown={() => pickNotify(e)}
                      style={{
                        padding: '10px 12px', border: 'none', background: 'transparent',
                        borderBottom: '1px solid #f1f3f5', cursor: 'pointer',
                      }}
                      onMouseEnter={ev => (ev.currentTarget.style.background = '#f8f9fa')}
                      onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                    >
                      {e.photo_url ? (
                        <img src={e.photo_url} alt={e.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <span className="rounded-circle d-inline-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0" style={{
                          width: 32, height: 32, fontSize: 11, background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                        }}>{initials || '?'}</span>
                      )}
                      <div className="min-w-0">
                        <div className="fw-semibold" style={{ fontSize: 13 }}>{e.name}</div>
                        {e.designation && <div className="text-muted" style={{ fontSize: 11 }}>{e.designation}</div>}
                        <div className="text-muted" style={{ fontSize: 11 }}>Employee Number: {e.emp_code}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="d-flex justify-content-end gap-2" style={{ padding: '14px 22px', borderTop: '1px solid #e5e7eb' }}>
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="rec-btn-primary"
            onClick={submit}
            disabled={!canSubmit}
            style={{ minWidth: 100 }}
          >
            {submitting ? <>Submitting… <i className="ri-loader-4-line ri-spin" /></> : 'Request'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}
