import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardBody, Col, Row } from 'reactstrap';
import FaceCapture, { type FaceCaptureResult } from '../components/FaceCapture';
import FaceRegistrationModal from '../components/FaceRegistrationModal';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';

interface AttendancePunch {
  id: number;
  punched_at: string;
  direction: 'in' | 'out';
  label: string;
  method: 'face' | 'manual' | 'auto';
  match_distance: number | null;
}

interface AttendanceRecord {
  id: number;
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string;
  next_direction: 'in' | 'out';
  punches_count: number;
  total_worked_seconds: number;
  punches: AttendancePunch[];
}

interface TodayResp {
  date: string;
  employee: {
    id: number; emp_code: string | null; name: string;
    face_registered: boolean;
  };
  record: AttendanceRecord | null;
  next_direction: 'in' | 'out';
  allowed_labels: string[];
}

// Activity-label palette — matches the methodology of the original
// "coming soon" Attendance design: warm reds for breaks out, cool greens
// for coming back, indigo for meetings.
const LABEL_TONE: Record<string, { bg: string; fg: string; dot: string; icon: string }> = {
  'Check In':  { bg: 'rgba(16,185,129,0.12)',  fg: '#047857', dot: '#10b981', icon: 'ri-login-circle-line'  },
  'Step Out':  { bg: 'rgba(245,158,11,0.12)',  fg: '#a16207', dot: '#f59e0b', icon: 'ri-walk-line'          },
  'Step In':   { bg: 'rgba(20,184,166,0.12)',  fg: '#0f766e', dot: '#14b8a6', icon: 'ri-walk-line'          },
  'Lunch Out': { bg: 'rgba(244,114,182,0.12)', fg: '#9d174d', dot: '#f472b6', icon: 'ri-restaurant-line'    },
  'Lunch In':  { bg: 'rgba(34,197,94,0.12)',   fg: '#166534', dot: '#22c55e', icon: 'ri-restaurant-line'    },
  'Meeting':   { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca', dot: '#6366f1', icon: 'ri-presentation-line'  },
  'Check Out': { bg: 'rgba(244,63,94,0.12)',   fg: '#9f1239', dot: '#f43f5e', icon: 'ri-logout-circle-line' },
};
const labelTone = (label: string) => LABEL_TONE[label] || {
  bg: 'rgba(100,116,139,0.12)', fg: '#475569', dot: '#64748b', icon: 'ri-time-line',
};

const fmtClock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtHM    = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

export default function ClockIn() {
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<TodayResp | null>(null);
  const [working, setWorking] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  // Live-ticking total — recomputed every second when the user is on the
  // clock so they can watch their work time accumulate.
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Pick which label the next punch will carry. Defaults sensibly per
  // direction; the user can override before tapping the camera.
  const [pickedLabel, setPickedLabel] = useState<string>('');

  const hasLinkedEmployee = !!user?.employee_id;

  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  const fetchToday = useCallback(async () => {
    if (!hasLinkedEmployee) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get('/attendance/today');
      setToday(r.data as TodayResp);
    } catch (err: any) {
      toastRef.current.error('Failed to load', err?.response?.data?.message || err?.message || 'Could not load today\'s attendance.');
      setToday(null);
    } finally {
      setLoading(false);
    }
  }, [hasLinkedEmployee]);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  // Tick the live total every second when the user has an open 'in' punch.
  useEffect(() => {
    if (!today?.record) return;
    const open = today.record.next_direction === 'out';
    if (!open) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [today?.record?.next_direction]);

  // Whenever the server's snapshot changes, reset the label to the smart default.
  useEffect(() => {
    if (!today?.record) {
      setPickedLabel('Check In');
      return;
    }
    if (today.next_direction === 'in') {
      setPickedLabel(today.record.punches_count === 0 ? 'Check In' : 'Step In');
    } else {
      setPickedLabel('Step Out');
    }
  }, [today?.next_direction, today?.record?.punches_count]);

  const tryGeo = (): Promise<{ lat: number; lng: number } | null> => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60_000 },
    );
  });

  const doPunch = useCallback(async (kind: 'in' | 'out', result: FaceCaptureResult) => {
    setWorking(true);
    try {
      const coords = await tryGeo();
      const path = kind === 'in' ? '/attendance/face/clock-in' : '/attendance/face/clock-out';
      const body: any = { descriptor: result.descriptor, label: pickedLabel };
      if (coords) { body.lat = coords.lat; body.lng = coords.lng; }
      const r = await api.post(path, body);
      toastRef.current.success(`${pickedLabel} recorded`,
        `Face match distance ${(r.data?.distance ?? 0).toFixed(3)}.`);
      await fetchToday();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.need_enroll) {
        toastRef.current.error('Face not registered', 'Please register your face before clocking in.');
        setShowRegister(true);
      } else if (typeof data?.matched === 'boolean' && !data.matched) {
        toastRef.current.error('Face did not match', data?.message || 'Please try again with better lighting.');
      } else {
        toastRef.current.error('Could not record attendance', data?.message || err?.message || 'Try again.');
      }
    } finally {
      setWorking(false);
    }
  }, [fetchToday, pickedLabel]);

  // All hooks must run on every render in the same order, so compute the
  // derived values BEFORE any early returns below.
  const record0 = today?.record ?? null;
  const punches0 = record0?.punches || [];
  const nextDir0 = today?.next_direction ?? 'in';

  // Live total worked seconds — server snapshot + delta from the open 'in'
  // (if any) to "now" so the timer ticks every second the user is on the
  // clock without re-hitting the API.
  const liveWorkedSeconds = useMemo(() => {
    if (!record0) return 0;
    let total = 0;
    let openInIso: string | null = null;
    for (const p of punches0) {
      if (p.direction === 'in') openInIso = p.punched_at;
      else if (openInIso) {
        total += Math.max(0, Math.floor((new Date(p.punched_at).getTime() - new Date(openInIso).getTime()) / 1000));
        openInIso = null;
      }
    }
    if (openInIso) {
      total += Math.max(0, Math.floor((nowTick - new Date(openInIso).getTime()) / 1000));
    }
    return total;
  }, [record0, punches0, nowTick]);

  // Quick-pick label set — only show the legal ones for the next direction.
  const quickLabels = useMemo<string[]>(() => {
    if (nextDir0 === 'in') {
      return punches0.length === 0 ? ['Check In'] : ['Step In', 'Lunch In', 'Meeting'];
    }
    return ['Step Out', 'Lunch Out', 'Meeting', 'Check Out'];
  }, [nextDir0, punches0.length]);

  // Empty state for non-employee accounts (no Employee row linked).
  if (!hasLinkedEmployee) {
    return (
      <Card><CardBody className="text-center py-5">
        <div style={{ fontSize: 44, color: '#94a3b8' }}><i className="ri-user-search-line" /></div>
        <h5 className="mt-2">Clock-In is for employees</h5>
        <p className="text-muted mb-0" style={{ fontSize: 14, maxWidth: 420, margin: '0 auto' }}>
          Your account doesn't have an employee record attached. If you need to view team attendance,
          go to <strong>HR &rsaquo; Attendance</strong>.
        </p>
      </CardBody></Card>
    );
  }

  if (loading) {
    return (
      <Card><CardBody className="d-flex align-items-center gap-2">
        <span className="spinner-border spinner-border-sm" /> Loading today's attendance…
      </CardBody></Card>
    );
  }
  if (!today) return <Card><CardBody>Could not load attendance. Please reload.</CardBody></Card>;

  const { employee, record } = today;
  const hasFace = employee.face_registered;
  const nextDir = today.next_direction;
  const isClockedIn  = nextDir === 'out';   // last punch was 'in', so the next is 'out'
  const punches = record?.punches || [];

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <div>
          <h4 className="mb-0">Attendance — Face Clock-In</h4>
          <small className="text-muted">
            {new Date(today.date).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </small>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className={`badge bg-${hasFace ? 'success-subtle text-success' : 'warning-subtle text-warning'}`}>
            <i className={`ri-${hasFace ? 'shield-check-line' : 'alert-line'} me-1`} />
            {hasFace ? 'Face Registered' : 'Face Not Registered'}
          </span>
          {hasFace && (
            <Button size="sm" color="light" onClick={() => setShowRegister(true)}>
              <i className="ri-refresh-line me-1" /> Re-register
            </Button>
          )}
        </div>
      </div>

      <Row className="g-3">
        {/* LEFT — webcam + label picker + capture */}
        <Col lg={7}>
          <Card>
            <CardBody>
              {!hasFace ? (
                <div className="text-center py-4">
                  <div style={{ fontSize: 44, color: '#f59e0b' }}><i className="ri-user-search-line" /></div>
                  <h5 className="mt-2">Register your face to start</h5>
                  <p className="text-muted" style={{ fontSize: 14 }}>
                    Face-based attendance requires a one-time enrolment. It takes about 10 seconds.
                  </p>
                  <Button color="primary" onClick={() => setShowRegister(true)}>
                    <i className="ri-camera-3-line me-1" /> Register Face Now
                  </Button>
                </div>
              ) : (
                <>
                  <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                    <h6 className="mb-0">
                      Ready to <strong>{isClockedIn ? 'Clock OUT' : 'Clock IN'}</strong>
                    </h6>
                    <span className="badge bg-light text-muted">
                      <i className="ri-time-line me-1" />
                      {fmtHM(liveWorkedSeconds)} worked today
                    </span>
                  </div>

                  {/* Activity label picker — quick chips + free text. */}
                  <div className="mb-3">
                    <div className="text-muted mb-2" style={{ fontSize: 12 }}>
                      Activity for this punch
                    </div>
                    <div className="d-flex flex-wrap gap-2">
                      {quickLabels.map(lbl => {
                        const t = labelTone(lbl);
                        const active = pickedLabel === lbl;
                        return (
                          <button
                            key={lbl}
                            type="button"
                            onClick={() => setPickedLabel(lbl)}
                            className="btn btn-sm d-inline-flex align-items-center gap-1"
                            style={{
                              background: active ? t.dot : t.bg,
                              color: active ? '#fff' : t.fg,
                              border: `1px solid ${active ? t.dot : 'transparent'}`,
                              borderRadius: 999,
                              padding: '6px 14px',
                              fontWeight: 600,
                              fontSize: 12.5,
                            }}
                          >
                            <i className={t.icon} /> {lbl}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <FaceCapture
                    captureLabel={isClockedIn ? `Clock Out — ${pickedLabel}` : `Clock In — ${pickedLabel}`}
                    onCapture={(r) => doPunch(isClockedIn ? 'out' : 'in', r)}
                    paused={working}
                  />
                  {working && (
                    <div className="mt-2 text-muted" style={{ fontSize: 12 }}>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Matching your face against the enrolled record…
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </Col>

        {/* RIGHT — today's summary */}
        <Col lg={5}>
          <Card>
            <CardBody>
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h6 className="mb-0">Today's Summary</h6>
                <span className="badge bg-primary-subtle text-primary">
                  {punches.length} {punches.length === 1 ? 'punch' : 'punches'}
                </span>
              </div>
              <Row className="g-3">
                <Col xs={4}>
                  <div className="p-3 rounded text-center" style={{ background: 'rgba(99,102,241,0.10)' }}>
                    <small className="text-muted">First In</small>
                    <div className="fs-5 fw-bold">{fmtClock(record?.check_in_at ?? null)}</div>
                  </div>
                </Col>
                <Col xs={4}>
                  <div className="p-3 rounded text-center" style={{ background: 'rgba(16,185,129,0.10)' }}>
                    <small className="text-muted">Last Out</small>
                    <div className="fs-5 fw-bold">{fmtClock(record?.check_out_at ?? null)}</div>
                  </div>
                </Col>
                <Col xs={4}>
                  <div className="p-3 rounded text-center" style={{ background: 'rgba(244,114,182,0.10)' }}>
                    <small className="text-muted">Worked</small>
                    <div className="fs-5 fw-bold">{fmtHM(liveWorkedSeconds)}</div>
                  </div>
                </Col>
              </Row>

              <hr className="my-3" />
              <div className="d-flex justify-content-between mb-2">
                <span className="text-muted">Status</span>
                <span className="fw-semibold">{record?.status || 'Not marked'}</span>
              </div>
              <div className="d-flex justify-content-between mb-2">
                <span className="text-muted">Employee</span>
                <span className="fw-semibold">{employee.name}</span>
              </div>
              {employee.emp_code && (
                <div className="d-flex justify-content-between">
                  <span className="text-muted">Code</span>
                  <span className="font-monospace">{employee.emp_code}</span>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        {/* FULL-WIDTH — intraday punch timeline */}
        <Col xs={12}>
          <Card>
            <CardBody>
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h6 className="mb-0">
                  <i className="ri-time-line me-1" />
                  Intraday Punch Timeline
                </h6>
                <small className="text-muted">
                  {punches.length} {punches.length === 1 ? 'punch' : 'punches'} today
                </small>
              </div>

              {punches.length === 0 ? (
                <div className="text-center py-4 text-muted" style={{ fontSize: 13 }}>
                  No punches yet today. Click <strong>Clock In</strong> above to record your first punch.
                </div>
              ) : (
                <div
                  className="d-flex gap-3 align-items-stretch flex-wrap"
                  style={{ overflowX: 'auto' }}
                >
                  {punches.map((p, idx) => {
                    const t = labelTone(p.label);
                    return (
                      <div
                        key={p.id}
                        className="position-relative d-flex flex-column align-items-center"
                        style={{ minWidth: 110, flex: '0 0 auto' }}
                      >
                        {/* Vertical connector to the next punch — skipped on the last. */}
                        {idx < punches.length - 1 && (
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute', top: 22, left: '60%', right: '-50%',
                              height: 2, background: 'rgba(148,163,184,0.35)',
                            }}
                          />
                        )}
                        <div
                          className="d-inline-flex align-items-center justify-content-center"
                          style={{
                            width: 44, height: 44, borderRadius: '50%',
                            background: t.bg,
                            color: t.fg,
                            border: `2px solid ${t.dot}`,
                            fontSize: 18,
                            zIndex: 1,
                          }}
                        >
                          <i className={t.icon} />
                        </div>
                        <div className="text-center mt-2" style={{ fontSize: 12.5, fontWeight: 700 }}>
                          {fmtClock(p.punched_at)}
                        </div>
                        <div className="text-center" style={{ fontSize: 12, color: t.fg, fontWeight: 600 }}>
                          {p.label}
                        </div>
                        <div
                          className="text-uppercase mt-1"
                          style={{ fontSize: 9.5, letterSpacing: 0.6, color: 'var(--vz-secondary-color)' }}
                        >
                          {p.method}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <FaceRegistrationModal
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onRegistered={fetchToday}
      />
    </>
  );
}
