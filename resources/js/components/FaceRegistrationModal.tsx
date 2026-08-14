import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'reactstrap';
import FaceCapture, { type FaceCaptureResult } from './FaceCapture';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
/* .rec-btn-ghost / .rec-btn-primary — the app's standard dialog buttons. */
import '../../css/recruitment.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pass an employee_id to enrol a different employee (admin path). When
   *  omitted, the enrolment is for the signed-in user. */
  employeeId?: number;
  /** Notified after a successful enrolment OR revoke so callers can refresh state. */
  onRegistered?: () => void;
}

/** Status response from GET /api/face/status. */
interface FaceStatus {
  employee_id: number;
  employee_name: string | null;
  employee_code: string | null;
  /** Employee's onboarding profile photo (NOT the face capture). We never
   *  store the captured face image — only the 128-d signature — so this is
   *  the safe-to-show passport-shot uploaded during onboarding. */
  photo_url: string | null;
  registered: boolean;
  registered_at: string | null;
  consent_given_at: string | null;
  consent_revoked_at: string | null;
  biometric_status: string | null;
}

type Step = 'loading' | 'already' | 'consent' | 'capture' | 'saving' | 'revoking' | 'done';

/**
 * Adaptive enrolment modal.
 *
 *   First-time path:    loading → consent → capture → saving → done
 *   Already-registered: loading → already → (re-register → capture → saving → done)
 *                                       OR (remove → revoking → done)
 *
 * On open the modal hits GET /api/face/status to see whether the target
 * employee already has a face on file. If they do, we skip the consent step
 * (they've already opted in once) and let the admin re-capture or revoke
 * without typing through the disclosure again.
 */
export default function FaceRegistrationModal({ open, onClose, employeeId, onRegistered }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('loading');
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<FaceCaptureResult | null>(null);
  const [status, setStatus] = useState<FaceStatus | null>(null);

  // Reset + (re-)fetch face status on every open. The query carries the
  // optional employee_id so admins acting on another employee's row get the
  // right row's status; self path omits it.
  useEffect(() => {
    if (!open) return;
    setStep('loading');
    setConsent(false);
    setResult(null);
    setStatus(null);
    const params: Record<string, any> = {};
    if (employeeId) params.employee_id = employeeId;
    api.get('/face/status', { params })
      .then((r: any) => {
        const s = r.data as FaceStatus;
        setStatus(s);
        // If a face is already on file, start on the "already-registered"
        // screen which shows the timestamp + offers Re-register / Remove.
        // Otherwise jump straight to the consent disclosure.
        setStep(s.registered ? 'already' : 'consent');
      })
      .catch(() => {
        // If status fetch fails (offline / 401 / 404) we fall through to
        // the consent path — the worst-case is the user sees the consent
        // step once more, never a hard break.
        setStep('consent');
      });
  }, [open, employeeId]);

  if (!open) return null;

  const handleCapture = (r: FaceCaptureResult) => setResult(r);

  const handleSave = async () => {
    if (!result) return;
    setStep('saving');
    try {
      const body: any = { descriptor: result.descriptor, consent: true };
      if (employeeId) body.employee_id = employeeId;
      await api.post('/face/register', body);
      toast.success('Face registered', 'Your face biometric is now linked to your account.');
      setStep('done');
      onRegistered?.();
      setTimeout(onClose, 800);
    } catch (err: any) {
      const data = err?.response?.data;
      const fieldMsg =
        data?.errors?.descriptor?.[0] ||
        data?.errors?.consent?.[0] ||
        data?.errors?.employee_id?.[0];
      const isDuplicate = typeof fieldMsg === 'string' && /already registered/i.test(fieldMsg);
      toast.error(
        isDuplicate ? 'Face already in use' : 'Could not save face data',
        fieldMsg || data?.message || err?.message || 'Try again.',
      );
      setStep('capture');
    }
  };

  // Revoke + wipe the existing face data. Skips the consent step on the
  // way back so the next opener of this modal will see the "first-time"
  // path again.
  const handleRevoke = async () => {
    setStep('revoking');
    try {
      const params: Record<string, any> = {};
      if (employeeId) params.employee_id = employeeId;
      await api.delete('/face/data', { params });
      toast.success('Face data removed', 'The enrolled face has been deleted.');
      onRegistered?.();
      onClose();
    } catch (err: any) {
      toast.error('Could not remove face data', err?.response?.data?.message || err?.message || 'Try again.');
      setStep('already');
    }
  };

  const fmtDateTime = (iso: string | null) => iso
    ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto',
      }}
      // Backdrop clicks no longer dismiss the modal — the user has to use
      // the explicit Close/Cancel button (or the × in the header). Stops
      // an accidental click outside the card from wiping out an in-progress
      // consent / capture state.
    >
      <div
        // `ep-modal-card` class hooks into the global dark-mode rule in
        // EmployeeProfile.css that pins the card background to
        // var(--vz-card-bg) — without it this inline `var(--vz-card-bg, #fff)`
        // falls back to white when the variable doesn't propagate into
        // the portal early enough and the modal renders bright on the
        // dark page.
        className="ep-modal-card"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)', borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          /* 680, not 560 — the consent copy was wrapping to three lines and each
             guarantee to two, which made a short disclosure look long. */
          width: '100%', maxWidth: 680, maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        <style>{`
          /* Sits on the gradient now, so it is a translucent white chip rather
             than a bordered light-grey square. */
          .frm-close-btn {
            border: 1px solid rgba(255,255,255,0.30);
            background: rgba(255,255,255,0.18);
            color: #fff;
            transition: background 0.15s ease, transform 0.15s ease;
          }
          .frm-close-btn:hover:not(:disabled) {
            background: rgba(255,255,255,0.34);
            color: #fff;
            transform: scale(1.06);
          }
          .frm-close-btn:active:not(:disabled) { transform: scale(0.94); }

          /* Each guarantee gets its own icon + line. As a bare <ul> the three
             points ran together as one grey block that nobody reads before
             ticking a consent box.
             NO box, though: a grey fill inside a 1px border is exactly what a
             disabled text input looks like in this app, so the three read as
             fields waiting to be filled rather than as statements. The icon
             carries the structure instead. */
          .frm-point {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 5px 2px;
            font-size: 12.5px; line-height: 1.55;
            color: var(--vz-body-color);
          }
          .frm-point i {
            font-size: 14px; flex-shrink: 0;
            width: 26px; height: 26px; border-radius: 8px;
            display: inline-flex; align-items: center; justify-content: center;
            background: rgba(124,92,252,0.12);
            color: #7c5cfc;
          }

          /* The consent tick IS the gate on this dialog, so unlike the points
             above it keeps a frame — but a violet one, and it sits above a rule
             so it reads as the decision rather than another field. */
          .frm-consent {
            display: flex; align-items: flex-start; gap: 10px;
            margin-top: 16px; padding: 12px 14px;
            border-radius: 10px;
            background: rgba(124,92,252,0.08);
            border: 1.5px solid rgba(124,92,252,0.45);
            cursor: pointer;
            transition: background .15s ease, border-color .15s ease;
          }
          .frm-consent:hover { background: rgba(124,92,252,0.14); border-color: rgba(124,92,252,0.70); }
          .frm-consent input { margin-top: 1px; width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; }
        `}</style>
        {/* Gradient header, matching Assign Assets and the Add/Edit Employee
            wizard. This dialog asks for biometric consent, and a plain bordered
            strip made it read as a throwaway confirm rather than a decision the
            user is being asked to record. */}
        <div
          className="d-flex align-items-center justify-content-between gap-3"
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(120deg,#5a3fd1 0%,#7c5cfc 55%,#a78bfa 100%)',
            color: '#fff',
          }}
        >
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span
              className="d-inline-flex align-items-center justify-content-center flex-shrink-0"
              style={{
                width: 42, height: 42, borderRadius: 12,
                background: 'rgba(255,255,255,0.22)',
                border: '2.5px solid rgba(255,255,255,0.55)',
              }}
            >
              <i className="ri-user-smile-line" style={{ fontSize: 20 }} />
            </span>
            <div className="min-w-0">
              <h6 className="mb-0 fw-bold text-white" style={{ fontSize: 16, letterSpacing: '-0.01em' }}>
                {step === 'already' ? 'Face Already Registered' : 'Register Your Face'}
              </h6>
              {/* Says what the dialog is for — the title alone doesn't. */}
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                {step === 'already'
                  ? 'Review, re-register or remove the stored face signature'
                  : 'Consent and capture for face-based attendance'}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm d-inline-flex align-items-center justify-content-center frm-close-btn flex-shrink-0"
            style={{ width: 30, height: 30, padding: 0, borderRadius: 8 }}
            onClick={onClose}
            disabled={step === 'saving' || step === 'revoking'}
            aria-label="Close"
          >
            <i className="ri-close-line" style={{ fontSize: 16 }} />
          </button>
        </div>

        <div className="px-3 py-3" style={{ overflowY: 'auto' }}>
          {step === 'loading' && (
            <div className="d-flex align-items-center justify-content-center gap-2 py-4 text-muted">
              <span className="spinner-border spinner-border-sm" /> Checking current registration…
            </div>
          )}

          {step === 'already' && status && (
            <>
              <div
                className="d-flex align-items-center gap-3 p-3 mb-3 rounded"
                style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.30)' }}
              >
                {/* Employee profile photo — the passport-size shot uploaded
                    during onboarding. We do NOT show the captured face here
                    because we never stored the photo — only the 128-d
                    signature. If no profile photo exists, fall back to a
                    neutral identity icon. */}
                {status.photo_url ? (
                  <img
                    src={status.photo_url}
                    alt={status.employee_name || 'Employee photo'}
                    style={{
                      width: 64, height: 64, borderRadius: '50%',
                      objectFit: 'cover',
                      border: '3px solid rgba(16,185,129,0.55)',
                      flexShrink: 0,
                      background: '#fff',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64, height: 64, borderRadius: '50%',
                      background: 'rgba(16,185,129,0.18)',
                      color: '#0a8a78',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 30, flexShrink: 0,
                      border: '3px solid rgba(16,185,129,0.55)',
                    }}
                    aria-label="No profile photo on file"
                  >
                    <i className="ri-user-line" />
                  </div>
                )}
                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                    <i className="ri-shield-check-line" style={{ color: '#10b981', fontSize: 18 }} />
                    <div className="fw-bold" style={{ fontSize: 14 }}>
                      {status.employee_name || 'This employee'} — face on file
                    </div>
                    {status.employee_code && (
                      <span
                        className="font-monospace"
                        style={{
                          background: 'rgba(15,23,42,0.08)', color: '#475569',
                          fontSize: 11, padding: '1px 6px', borderRadius: 4,
                        }}
                      >
                        {status.employee_code}
                      </span>
                    )}
                  </div>
                  <small className="text-muted d-block" style={{ fontSize: 12 }}>
                    Registered on <strong>{fmtDateTime(status.registered_at)}</strong>
                  </small>
                  {status.consent_given_at && (
                    <small className="text-muted d-block" style={{ fontSize: 12 }}>
                      Consent given on <strong>{fmtDateTime(status.consent_given_at)}</strong>
                    </small>
                  )}
                </div>
              </div>

              <p className="text-muted mb-2" style={{ fontSize: 13 }}>
                You can <strong>re-register</strong> to replace the captured face (helpful after a haircut,
                glasses change, or any other appearance shift), or <strong>remove</strong> the data
                entirely. Removing wipes the signature; the consent audit record is preserved.
              </p>

              <ul style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)', lineHeight: 1.7, paddingLeft: 18, marginBottom: 0 }}>
                <li>The stored signature is the 128-number vector — never the raw face photo. The picture above is the employee's onboarding profile shot, shown for identification only.</li>
                <li>Re-registering replaces the old vector immediately; clock-in matches use the new one from the next punch onward.</li>
                <li>Removing logs a revoke timestamp so the audit trail is complete.</li>
              </ul>
            </>
          )}

          {step === 'consent' && (
            <>
              <p className="mb-3" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                Your face image is used <strong>only to mark attendance</strong>. We do not store the photo.
                We extract a 128-number mathematical signature from the image and store that — it cannot
                be reversed into a recognisable face.
              </p>
              <div className="d-flex flex-column gap-1">
                <div className="frm-point">
                  <i className="ri-fingerprint-line" />
                  <span>The signature is kept on your employee record and used to verify clock-in / clock-out.</span>
                </div>
                <div className="frm-point">
                  <i className="ri-delete-bin-line" />
                  <span>You can revoke this consent at any time and we will delete the data.</span>
                </div>
                <div className="frm-point">
                  <i className="ri-shield-check-line" />
                  <span>This data is never shared with third parties.</span>
                </div>
              </div>
              {/* Whole box is the label, so the tick target is the full row
                  rather than a 16px square. */}
              <label className="frm-consent" htmlFor="face-consent">
                <input
                  type="checkbox"
                  id="face-consent"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                />
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  I consent to my face biometric being stored for attendance purposes.
                </span>
              </label>
            </>
          )}

          {(step === 'capture' || step === 'saving') && (
            <>
              <p className="text-muted mb-2" style={{ fontSize: 13 }}>
                Position your face inside the dashed circle, look at the camera and click <strong>Capture</strong>.
                Make sure the room is well-lit and only your face is in the frame.
              </p>
              {result ? (
                <div className="d-flex align-items-center gap-3 flex-wrap">
                  <img
                    src={result.previewDataUrl}
                    alt="Face preview"
                    style={{ width: 200, height: 150, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--vz-border-color)' }}
                  />
                  <div>
                    <div style={{ fontSize: 13 }}>
                      <i className="ri-check-line text-success me-1" />
                      Face detected (confidence {(result.detectionScore * 100).toFixed(0)}%).
                    </div>
                    <button
                      type="button"
                      className="btn btn-link p-0 mt-1"
                      onClick={() => setResult(null)}
                      disabled={step === 'saving'}
                      style={{ fontSize: 13 }}
                    >
                      <i className="ri-refresh-line me-1" /> Retake
                    </button>
                  </div>
                </div>
              ) : (
                <FaceCapture onCapture={handleCapture} captureLabel="Capture face" />
              )}
            </>
          )}

          {step === 'revoking' && (
            <div className="d-flex align-items-center justify-content-center gap-2 py-4 text-muted">
              <span className="spinner-border spinner-border-sm" /> Removing face data…
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-4">
              <div style={{ fontSize: 40, color: '#10b981' }}>
                <i className="ri-checkbox-circle-line" />
              </div>
              <h6 className="mt-2 mb-0">Face registered</h6>
              <small className="text-muted">You can now use face-based attendance.</small>
            </div>
          )}
        </div>

        <div className="d-flex justify-content-end gap-2 px-3 py-3" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
          {step === 'already' && (
            <>
              <button type="button" className="rec-btn-ghost" onClick={onClose}>Close</button>
              {/* Destructive action keeps its own red outline — it must not
                  look like the two neutral buttons beside it. */}
              <Button color="danger" outline onClick={handleRevoke} style={{ height: 36, borderRadius: 10, fontSize: 12.5, fontWeight: 700 }}>
                <i className="ri-delete-bin-line me-1" /> Remove Face Data
              </Button>
              <button type="button" className="rec-btn-primary" onClick={() => setStep('capture')}>
                <i className="ri-refresh-line" /> Re-register
              </button>
            </>
          )}
          {step === 'consent' && (
            <>
              <button type="button" className="rec-btn-ghost" onClick={onClose}>Cancel</button>
              {/* Held until the box is ticked — consent is the whole point of
                  this step, so the button states it plainly rather than sitting
                  there looking merely faded. */}
              <button type="button" className="rec-btn-primary" onClick={() => setStep('capture')} disabled={!consent}
                style={!consent ? { opacity: 0.45, cursor: 'not-allowed', boxShadow: 'none' } : undefined}
                title={!consent ? 'Tick the consent box to continue' : undefined}
              >
                I Agree, Continue
              </button>
            </>
          )}
          {(step === 'capture' || step === 'saving') && (
            <>
              <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={step === 'saving'}>Cancel</button>
              <button type="button" className="rec-btn-primary" onClick={handleSave} disabled={!result || step === 'saving'}
                style={(!result || step === 'saving') ? { opacity: 0.45, cursor: 'not-allowed', boxShadow: 'none' } : undefined}
              >
                {step === 'saving'
                  ? (<><span className="spinner-border spinner-border-sm" /> Saving…</>)
                  : (<><i className="ri-save-line" /> Save Face Data</>)}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
