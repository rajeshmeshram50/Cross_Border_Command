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
  /** Notified after a successful enrolment so callers can refresh state. */
  onRegistered?: () => void;
}

/**
 * Two-step modal: (1) consent disclosure → (2) face capture → submit.
 *
 * The consent step is non-skippable: biometric data is special-category under
 * DPDP / GDPR so we have to record explicit opt-in before storing the
 * descriptor. The backend reinforces this with an `accepted` rule.
 */
export default function FaceRegistrationModal({ open, onClose, employeeId, onRegistered }: Props) {
  const toast = useToast();
  const [step, setStep] = useState<'consent' | 'capture' | 'saving' | 'done'>('consent');
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<FaceCaptureResult | null>(null);

  useEffect(() => {
    if (open) {
      setStep('consent');
      setConsent(false);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const handleCapture = (r: FaceCaptureResult) => {
    setResult(r);
  };

  const handleSave = async () => {
    if (!result) return;
    setStep('saving');
    try {
      const body: any = {
        descriptor: result.descriptor,
        consent: true,
      };
      if (employeeId) body.employee_id = employeeId;
      await api.post('/face/register', body);
      toast.success('Face registered', 'Your face biometric is now linked to your account.');
      setStep('done');
      onRegistered?.();
      setTimeout(onClose, 800);
    } catch (err: any) {
      toast.error('Could not save face data', err?.response?.data?.message || err?.message || 'Try again.');
      setStep('capture');
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto',
      }}
      onClick={() => { if (step !== 'saving') onClose(); }}
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
            <h6 className="mb-0 fw-bold">Register Your Face</h6>
          </div>
          <button type="button" className="btn btn-light btn-sm" onClick={onClose} disabled={step === 'saving'} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="px-3 py-3" style={{ overflowY: 'auto' }}>
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
