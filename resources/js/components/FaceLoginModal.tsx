import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'reactstrap';
import FaceCapture, { type FaceCaptureResult } from './FaceCapture';
import { useToast } from '../contexts/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Bound to the Login page's email field so the user doesn't retype. */
  initialEmail?: string;
  /** Returns success — page logs the user in via AuthContext.faceLogin. */
  onSubmit: (email: string, descriptor: number[]) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Face-login modal: confirm email → capture face → submit.
 *
 * The email field is editable here (not just an inert echo of the parent's
 * input) because some users will open the modal from a clean state and prefer
 * to enter their email in the modal itself. Pre-filled when the Login page
 * already has an email typed.
 */
export default function FaceLoginModal({ open, onClose, initialEmail = '', onSubmit }: Props) {
  const toast = useToast();
  const [email, setEmail]   = useState(initialEmail);
  const [result, setResult] = useState<FaceCaptureResult | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setResult(null);
      setWorking(false);
    }
  }, [open, initialEmail]);

  if (!open) return null;

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) { toast.warning('Email required', 'Enter your account email first.'); return; }
    if (!result)  { toast.warning('Face required', 'Capture your face before signing in.'); return; }
    setWorking(true);
    try {
      const out = await onSubmit(trimmed, result.descriptor);
      if (out.success) {
        toast.success('Welcome back!', 'Face authenticated successfully.');
        onClose();
      } else {
        toast.error('Face login failed', out.error || 'Try again or use password.');
        // Keep the modal open so user can retake the face / fix the email.
      }
    } finally {
      setWorking(false);
    }
  };

  return createPortal(
    <div
      className="cbc-face-login-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto',
      }}
      onClick={() => { if (!working) onClose(); }}
    >
      <style>{`
        /* The login page lives outside the main shell so the dark-theme
           data-attribute on <html> doesn't always cascade into the body
           portal — which is why this modal used to render pure white in
           dark mode. Anchor everything to .cbc-face-login-card and let
           [data-bs-theme="dark"] override surfaces, borders, inputs and
           buttons so the modal matches the dark login surface. */
        .cbc-face-login-card {
          background: #ffffff;
          color: #1f2937;
        }
        .cbc-face-login-head,
        .cbc-face-login-foot {
          border-color: #e5e7eb;
        }
        .cbc-face-login-card .form-control {
          background: #ffffff;
          color: #1f2937;
          border-color: #d1d5db;
        }
        .cbc-face-login-card .text-muted { color: #6b7280 !important; }
        .cbc-face-login-x {
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #e5e7eb;
        }

        [data-bs-theme="dark"] .cbc-face-login-card {
          background: #222831 !important;
          color: rgba(255,255,255,0.92) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-head,
        [data-bs-theme="dark"] .cbc-face-login-foot {
          border-color: rgba(255,255,255,0.10) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-card h6 {
          color: rgba(255,255,255,0.95) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-card label {
          color: rgba(255,255,255,0.78) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-card .form-control {
          background: rgba(255,255,255,0.04) !important;
          color: rgba(255,255,255,0.92) !important;
          border-color: rgba(255,255,255,0.16) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-card .form-control::placeholder {
          color: rgba(255,255,255,0.40) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-card .text-muted {
          color: rgba(255,255,255,0.55) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-x {
          background: rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.85) !important;
          border-color: rgba(255,255,255,0.14) !important;
        }
        /* Cancel button (color="light") is normally a bright wash —
           in dark mode we want a subdued translucent surface. */
        [data-bs-theme="dark"] .cbc-face-login-card .btn-light {
          background: rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.85) !important;
          border-color: rgba(255,255,255,0.14) !important;
        }
        [data-bs-theme="dark"] .cbc-face-login-card .btn-light:hover {
          background: rgba(255,255,255,0.14) !important;
        }
      `}</style>
      <div
        className="cbc-face-login-card"
        onClick={e => e.stopPropagation()}
        style={{
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        <div className="cbc-face-login-head d-flex align-items-center justify-content-between px-3 py-3" style={{ borderBottom: '1px solid' }}>
          <div className="d-flex align-items-center gap-2">
            <span style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(99,102,241,0.18)', color: '#a78bfa', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="ri-user-smile-line" />
            </span>
            <h6 className="mb-0 fw-bold">Sign in with Face</h6>
          </div>
          <button type="button" className="btn btn-sm cbc-face-login-x" onClick={onClose} disabled={working} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="px-3 py-3" style={{ overflowY: 'auto' }}>
          <div className="mb-3">
            <label style={{ fontSize: 12, fontWeight: 600 }} className="mb-1">Email</label>
            <input
              type="email"
              className="form-control"
              placeholder="you@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={working}
              autoFocus
            />
            <small className="text-muted" style={{ fontSize: 12 }}>
              We match the captured face against this account's enrolled descriptor.
            </small>
          </div>

          {result ? (
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <img
                src={result.previewDataUrl}
                alt="Face preview"
                style={{ width: 180, height: 135, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--vz-border-color, rgba(255,255,255,0.16))' }}
              />
              <div>
                <div style={{ fontSize: 13 }}>
                  <i className="ri-check-line text-success me-1" />
                  Face captured (confidence {(result.detectionScore * 100).toFixed(0)}%).
                </div>
                <button
                  type="button"
                  className="btn btn-link p-0 mt-1"
                  onClick={() => setResult(null)}
                  disabled={working}
                  style={{ fontSize: 13 }}
                >
                  <i className="ri-refresh-line me-1" /> Retake
                </button>
              </div>
            </div>
          ) : (
            <FaceCapture onCapture={setResult} captureLabel="Capture face" />
          )}
        </div>

        <div className="cbc-face-login-foot d-flex justify-content-end gap-2 px-3 py-3" style={{ borderTop: '1px solid' }}>
          <Button color="light" size="sm" onClick={onClose} disabled={working}>Cancel</Button>
          <Button color="primary" size="sm" onClick={handleSubmit} disabled={!result || !email || working}>
            {working
              ? (<><span className="spinner-border spinner-border-sm me-2" /> Verifying…</>)
              : 'Sign in with Face'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
