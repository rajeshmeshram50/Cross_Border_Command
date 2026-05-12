import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'reactstrap';
import FaceCapture, { type FaceCaptureResult } from './FaceCapture';
import { useToast } from '../contexts/ToastContext';
import api from '../api';

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
      onClick={() => { if (step !== 'saving' && step !== 'revoking') onClose(); }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)', borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        <div className="d-flex align-items-center justify-content-between px-3 py-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
          <div className="d-flex align-items-center gap-2">
            <span style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(99,102,241,0.18)', color: '#4338ca', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ri-user-smile-line" />
            </span>
            <h6 className="mb-0 fw-bold">
              {step === 'already' ? 'Face Already Registered' : 'Register Your Face'}
            </h6>
          </div>
          <button
            type="button"
            className="btn btn-light btn-sm"
            onClick={onClose}
            disabled={step === 'saving' || step === 'revoking'}
            aria-label="Close"
          >
            <i className="ri-close-line" />
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
              <p className="mb-2" style={{ fontSize: 14 }}>
                Your face image is used <strong>only to mark attendance</strong>. We do not store the photo.
                We extract a 128-number mathematical signature from the image and store that — it cannot
                be reversed into a recognisable face.
              </p>
              <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18 }}>
                <li>The signature is kept on your employee record and used to verify clock-in / clock-out.</li>
                <li>You can revoke this consent at any time and we will delete the data.</li>
                <li>This data is never shared with third parties.</li>
              </ul>
              <div className="form-check mt-3">
                <input
                  type="checkbox"
                  id="face-consent"
                  className="form-check-input"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                />
                <label htmlFor="face-consent" className="form-check-label" style={{ fontSize: 13 }}>
                  I consent to my face biometric being stored for attendance purposes.
                </label>
              </div>
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
              <Button color="light" size="sm" onClick={onClose}>Close</Button>
              <Button color="danger" size="sm" outline onClick={handleRevoke}>
                <i className="ri-delete-bin-line me-1" /> Remove Face Data
              </Button>
              <Button color="primary" size="sm" onClick={() => setStep('capture')}>
                <i className="ri-refresh-line me-1" /> Re-register
              </Button>
            </>
          )}
          {step === 'consent' && (
            <>
              <Button color="light" size="sm" onClick={onClose}>Cancel</Button>
              <Button color="primary" size="sm" onClick={() => setStep('capture')} disabled={!consent}>
                I Agree, Continue
              </Button>
            </>
          )}
          {(step === 'capture' || step === 'saving') && (
            <>
              <Button color="light" size="sm" onClick={onClose} disabled={step === 'saving'}>Cancel</Button>
              <Button color="primary" size="sm" onClick={handleSave} disabled={!result || step === 'saving'}>
                {step === 'saving'
                  ? (<><span className="spinner-border spinner-border-sm me-2" /> Saving…</>)
                  : 'Save Face Data'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
