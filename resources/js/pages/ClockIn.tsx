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
  // Geo captured at the moment of the punch (sent by SPA on
  // /attendance/face/clock-in and clock-out). Optional — pre-existing
  // punches from before geo capture shipped will not have these.
  lat?: number | null;
  lng?: number | null;
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

type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'timeout';
type GeoFix = { lat: number; lng: number; accuracy: number; capturedAt: number; address?: string };

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

  // Live geolocation captured on mount + refreshed every 30s. Shown to the
  // employee so they can see EXACTLY what gets stamped on their punch.
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [geoFix, setGeoFix] = useState<GeoFix | null>(null);

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
    setPickedLabel(today.next_direction === 'in' ? 'Check In' : 'Check Out');
  }, [today?.next_direction, today?.record?.punches_count]);

  // Probe geolocation and update the visible status. Called on mount and
  // refreshed periodically so the displayed coords are always current.
  const refreshGeo = useCallback(() => {
    if (!navigator.geolocation) { setGeoStatus('unavailable'); return; }
    setGeoStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: GeoFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
          capturedAt: Date.now(),
        };
        setGeoFix(fix);
        setGeoStatus('granted');
        // Best-effort reverse geocode via BigDataCloud (free, no key).
        // If it fails or is blocked, we just keep showing raw coords.
        fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${fix.lat}&longitude=${fix.lng}&localityLanguage=en`)
          .then(r => r.ok ? r.json() : null)
          .then((data: any) => {
            if (!data) return;
            const parts = [data.locality, data.principalSubdivision, data.countryName].filter(Boolean);
            const address = parts.join(', ');
            if (address) setGeoFix(prev => prev && prev.capturedAt === fix.capturedAt ? { ...prev, address } : prev);
          })
          .catch(() => {/* silent — coords-only fallback */});
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGeoStatus('denied');
        else if (err.code === err.TIMEOUT) setGeoStatus('timeout');
        else setGeoStatus('unavailable');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }, []);

  // Kick off location capture on mount and refresh every 30s. Aggressive
  // refresh means the punch always stamps a fresh-ish fix without having
  // to wait on getCurrentPosition() at click time.
  useEffect(() => {
    refreshGeo();
    const id = setInterval(refreshGeo, 30_000);
    return () => clearInterval(id);
  }, [refreshGeo]);

  // Snapshot of the current best coords for the punch payload. Returns the
  // cached fix if it's <60s old, otherwise asks the browser one more time
  // (with a short timeout — the camera capture has already given us a few
  // seconds, and we don't want to block the punch indefinitely).
  const captureGeoForPunch = (): Promise<{ lat: number; lng: number } | null> => {
    if (geoFix && Date.now() - geoFix.capturedAt < 60_000) {
      return Promise.resolve({ lat: geoFix.lat, lng: geoFix.lng });
    }
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 4000, maximumAge: 60_000 },
      );
    });
  };

  const doPunch = useCallback(async (kind: 'in' | 'out', result: FaceCaptureResult) => {
    setWorking(true);
    try {
      const coords = await captureGeoForPunch();
      const path = kind === 'in' ? '/attendance/face/clock-in' : '/attendance/face/clock-out';
      const body: any = { descriptor: result.descriptor, label: pickedLabel };
      if (coords) { body.lat = coords.lat; body.lng = coords.lng; }
      const r = await api.post(path, body);
      const locNote = coords
        ? ` · 📍 ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
        : ' · location unavailable';
      toastRef.current.success(`${pickedLabel} recorded`,
        `Face match distance ${(r.data?.distance ?? 0).toFixed(3)}.${locNote}`);
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
  }, [fetchToday, pickedLabel, geoFix]);

  // All hooks must run on every render in the same order, so compute the
  // derived values BEFORE any early returns below.
  const record0 = today?.record ?? null;
  const punches0 = record0?.punches || [];
  const nextDir0 = today?.next_direction ?? 'in';

  // Live total worked seconds — completed pairs plus the open 'in' (if any)
  // extended only up to a 9 PM auto-checkout, so the timer ticks until 9 PM
  // and then freezes (no hours counted past 9 PM). Matches the model + branch
  // logic so the same record reads the same everywhere.
  const liveWorkedSeconds = useMemo(() => {
    if (!record0) return 0;
    // 9 PM local today — the auto-checkout boundary for an open punch.
    const cutoff = new Date();
    cutoff.setHours(21, 0, 0, 0);
    const cutoffMs = cutoff.getTime();
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
      const boundary = Math.min(nowTick, cutoffMs);
      total += Math.max(0, Math.floor((boundary - new Date(openInIso).getTime()) / 1000));
    }
    return total;
  }, [record0, punches0, nowTick]);

  // Quick-pick label set — simplified to just Check In / Check Out.
  const quickLabels = useMemo<string[]>(() => {
    return nextDir0 === 'in' ? ['Check In'] : ['Check Out'];
  }, [nextDir0]);

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

                  {/* Live location capture card — shows the employee what
                      coordinates will be stamped on this punch. */}
                  <LocationCaptureCard status={geoStatus} fix={geoFix} onRefresh={refreshGeo} />
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
                        {p.lat != null && p.lng != null && (
                          <a
                            href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="d-inline-flex align-items-center gap-1 mt-1"
                            title={`Open ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} on Google Maps`}
                            style={{
                              fontSize: 10, fontWeight: 700,
                              padding: '2px 8px', borderRadius: 999,
                              background: 'rgba(16,185,129,0.12)',
                              color: '#047857',
                              border: '1px solid rgba(16,185,129,0.35)',
                              textDecoration: 'none',
                              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                            }}
                          >
                            <i className="ri-map-pin-2-line" />
                            {p.lat.toFixed(3)}, {p.lng.toFixed(3)}
                          </a>
                        )}
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

/* ─── Live location capture card — sits under the webcam so the employee
   can see exactly what coordinates will be stamped on their punch. ─── */
function LocationCaptureCard(props: { status: GeoStatus; fix: GeoFix | null; onRefresh: () => void }) {
  const { status, fix, onRefresh } = props;

  const palette = (() => {
    switch (status) {
      case 'granted':     return { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.40)', fg: '#047857', icon: 'ri-map-pin-2-line',         dot: '#10b981' };
      case 'requesting':  return { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.40)', fg: '#4338ca', icon: 'ri-loader-4-line',          dot: '#6366f1' };
      case 'denied':      return { bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.40)',  fg: '#9f1239', icon: 'ri-map-pin-user-line',      dot: '#f43f5e' };
      case 'unavailable': return { bg: 'rgba(100,116,139,0.10)',border: 'rgba(100,116,139,0.40)',fg: '#475569', icon: 'ri-map-pin-off-line',       dot: '#64748b' };
      case 'timeout':     return { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.40)', fg: '#a16207', icon: 'ri-time-line',              dot: '#f59e0b' };
      default:            return { bg: 'rgba(100,116,139,0.10)',border: 'rgba(100,116,139,0.40)',fg: '#475569', icon: 'ri-map-pin-line',           dot: '#64748b' };
    }
  })();

  const headline = (() => {
    switch (status) {
      case 'granted':     return 'Location captured';
      case 'requesting':  return 'Capturing location…';
      case 'denied':      return 'Location permission denied';
      case 'unavailable': return 'Location not available on this device';
      case 'timeout':     return 'Location timed out — using last known fix';
      default:            return 'Location: not started';
    }
  })();

  return (
    <div
      className="mt-3 p-3 d-flex align-items-center gap-3 flex-wrap"
      style={{
        background: palette.bg,
        border: `1.5px solid ${palette.border}`,
        borderRadius: 12,
      }}
    >
      <div
        className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
        style={{
          width: 40, height: 40, borderRadius: 10,
          background: palette.dot, color: '#fff', fontSize: 18,
        }}
      >
        <i className={palette.icon} style={status === 'requesting' ? { animation: 'spin 1.2s linear infinite' } : undefined} />
      </div>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: palette.fg }}>
          {headline}
        </div>
        {fix ? (
          <>
            <div
              className="mt-1"
              style={{ fontSize: 12, color: '#1e293b', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
            >
              <i className="ri-focus-3-line me-1" />
              {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              {fix.accuracy ? <span style={{ color: '#64748b', fontWeight: 500, marginLeft: 8 }}>±{Math.round(fix.accuracy)}m</span> : null}
            </div>
            {fix.address && (
              <div className="mt-1" style={{ fontSize: 11.5, color: palette.fg, fontWeight: 600 }}>
                <i className="ri-building-2-line me-1" />
                {fix.address}
              </div>
            )}
          </>
        ) : status === 'denied' ? (
          <div className="mt-1" style={{ fontSize: 11.5, color: '#64748b' }}>
            Your browser blocked location access. Open the lock icon next to the URL → Site settings → allow Location.
          </div>
        ) : status === 'unavailable' ? (
          <div className="mt-1" style={{ fontSize: 11.5, color: '#64748b' }}>
            Geolocation isn't supported here. The punch will still record but won't include coordinates.
          </div>
        ) : (
          <div className="mt-1" style={{ fontSize: 11.5, color: '#64748b' }}>
            Waiting for a GPS / Wi-Fi fix from your device…
          </div>
        )}
      </div>

      <div className="d-flex align-items-center gap-2 flex-shrink-0">
        {fix && (
          <a
            href={`https://www.google.com/maps?q=${fix.lat},${fix.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-light"
            style={{ fontSize: 11.5, fontWeight: 700 }}
            title="Open on Google Maps"
          >
            <i className="ri-external-link-line me-1" />
            View on map
          </a>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRefresh}
          style={{
            background: palette.dot, color: '#fff',
            fontSize: 11.5, fontWeight: 700, border: 'none',
          }}
          title="Re-capture location"
        >
          <i className="ri-refresh-line me-1" />
          Refresh
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
