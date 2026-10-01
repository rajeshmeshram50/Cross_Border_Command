import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
    <div className="kxf-overlay" onClick={() => { if (!working) onClose(); }}>
      <style>{`
        /* Same look as the KRYPTONE.AI sign-in card (layouts/AuthCardLayout.css):
           near-black navy glass, a thin lit rim, navy fields and gradient
           pills. Always dark, so it reads the same over the dark login page in
           either theme. FaceCapture's own boxes are restyled from here so the
           camera fills the card; its logic is untouched. */
        .kxf-overlay {
          position: fixed; inset: 0; z-index: 5000;
          display: flex; align-items: center; justify-content: center;
          padding: 16px; overflow-y: auto;
          background: rgba(2, 8, 20, .62);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          font-family: 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif;
        }
        .kxf-card {
          position: relative; width: 100%; max-width: 520px; max-height: calc(100vh - 32px);
          display: flex; flex-direction: column; overflow: hidden;
          border-radius: 26px; color: #eef1f7;
          background: linear-gradient(180deg, rgba(14, 30, 54, .94) 0%, rgba(6, 18, 38, .97) 100%);
          box-shadow:
            inset 0 0 0 1px rgba(205, 220, 255, .55),
            inset 0 0 12px rgba(140, 170, 255, .12),
            0 0 1px rgba(225, 238, 255, .5),
            -10px 14px 30px -14px rgba(60, 140, 255, .6),
            10px 14px 30px -14px rgba(170, 90, 255, .6),
            0 30px 70px rgba(0, 0, 0, .55);
        }
        .kxf-head { display: flex; align-items: center; justify-content: space-between; padding: 22px 24px 6px; }
        .kxf-title { display: flex; align-items: center; gap: 12px; }
        .kxf-badge {
          width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0;
          display: inline-flex; align-items: center; justify-content: center;
          color: #fff; font-size: 19px;
          background: linear-gradient(135deg, #1b90fe, #8438fc);
          box-shadow: 0 6px 16px rgba(80, 90, 255, .45);
        }
        .kxf-title h6 { margin: 0; font-size: 19px; font-weight: 700; color: #fff; letter-spacing: -.01em; }
        .kxf-title p { margin: 2px 0 0; font-size: 12.5px; color: #9aa3b5; }
        .kxf-x {
          width: 34px; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.06); color: #dbe2f0; font-size: 18px; line-height: 1;
          display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
          transition: background .15s;
        }
        .kxf-x:hover:not(:disabled) { background: rgba(255,255,255,.12); color: #fff; }
        .kxf-body { padding: 16px 24px 4px; overflow-y: auto; }
        .kxf-field {
          display: flex; align-items: center; gap: 16px; height: 58px; padding: 0 18px;
          border-radius: 10px; background: rgba(36, 52, 78, .70); border: 1px solid rgba(255,255,255,.14);
          transition: border-color .18s, box-shadow .18s;
        }
        .kxf-field:focus-within { border-color: rgba(96,165,250,.55); box-shadow: 0 0 0 3px rgba(59,130,246,.18); }
        .kxf-field > i { font-size: 21px; color: #e6e9f2; }
        .kxf-field-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .kxf-field-body span { font-size: 12px; color: #9aa3b5; line-height: 1; }
        .kxf-field-body input {
          width: 100%; border: 0; outline: 0; background: transparent; padding: 0;
          font: inherit; font-size: 14px; color: #f1f5f9;
        }
        .kxf-field-body input::placeholder { color: #9aa3b5; }
        .kxf-hint { margin: 8px 2px 16px; font-size: 12px; color: #8f98ab; }
        /* FaceCapture: camera fills the card, guide ring in the brand cyan */
        .kxf-body .d-flex.flex-column > div:first-child {
          max-width: none !important; border-radius: 16px !important;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), 0 12px 30px rgba(0,0,0,.35) !important;
        }
        .kxf-body .d-flex.flex-column > div:first-child > div:nth-child(2) > div {
          border: 2px dashed rgba(90, 200, 255, .75) !important;
          box-shadow: 0 0 18px rgba(60, 160, 255, .35);
        }
        .kxf-body .btn-primary {
          height: 50px; margin-top: 6px; border: 0; border-radius: 999px;
          font-size: 15px; font-weight: 600; color: #fff;
          background: linear-gradient(90deg, #1b90fe 0%, #454ffd 50%, #8438fc 100%);
          box-shadow: 0 8px 22px rgba(70, 80, 255, .40), inset 0 1px 0 rgba(255,255,255,.22);
          transition: transform .15s, filter .15s;
        }
        .kxf-body .btn-primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
        .kxf-body .btn-primary:disabled { opacity: .55; }
        .kxf-done { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .kxf-done img { width: 180px; height: 135px; object-fit: cover; border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
        .kxf-ok { font-size: 13.5px; color: #e6eaf2; }
        .kxf-ok i { color: #34d399; margin-right: 6px; }
        .kxf-retake { margin-top: 8px; padding: 0; border: 0; background: none; font: inherit; font-size: 13.5px; color: #38c8f5; cursor: pointer; }
        .kxf-retake:hover { color: #7dd8fb; text-decoration: underline; }
        .kxf-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 18px 24px 22px; }
        .kxf-btn {
          height: 44px; padding: 0 22px; border-radius: 999px; font: inherit; font-size: 14px; font-weight: 600;
          cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: transform .15s, filter .15s, background .15s;
        }
        .kxf-btn--ghost { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #dbe2f0; }
        .kxf-btn--ghost:hover:not(:disabled) { background: rgba(255,255,255,.12); color: #fff; }
        .kxf-btn--go {
          border: 0; color: #fff;
          background: linear-gradient(90deg, #1b90fe 0%, #454ffd 50%, #8438fc 100%);
          box-shadow: 0 8px 22px rgba(70, 80, 255, .40), inset 0 1px 0 rgba(255,255,255,.22);
        }
        .kxf-btn--go:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
        .kxf-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
        .kxf-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; animation: kxf-rot .75s linear infinite; }
        @keyframes kxf-rot { to { transform: rotate(360deg); } }
        @media (max-width: 480px) {
          .kxf-head { padding: 18px 18px 4px; } .kxf-body { padding: 14px 18px 4px; } .kxf-foot { padding: 16px 18px 18px; }
          .kxf-btn { flex: 1; justify-content: center; }
        }
      `}</style>
      <div className="kxf-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Sign in with Face">
        <div className="kxf-head">
          <div className="kxf-title">
            <span className="kxf-badge"><i className="ri-user-smile-line" /></span>
            <div>
              <h6>Sign in with Face</h6>
              <p>Look at the camera and capture your face.</p>
            </div>
          </div>
          <button type="button" className="kxf-x" onClick={onClose} disabled={working} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="kxf-body">
          <label className="kxf-field">
            <i className="ri-mail-line" />
            <span className="kxf-field-body">
              <span>Email ID</span>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={working}
                autoFocus
              />
            </span>
          </label>
          <div className="kxf-hint">We match the captured face against this account's enrolled face.</div>

          {result ? (
            <div className="kxf-done">
              <img src={result.previewDataUrl} alt="Face preview" />
              <div>
                <div className="kxf-ok">
                  <i className="ri-checkbox-circle-fill" />
                  Face captured (confidence {(result.detectionScore * 100).toFixed(0)}%).
                </div>
                <button type="button" className="kxf-retake" onClick={() => setResult(null)} disabled={working}>
                  <i className="ri-refresh-line me-1" /> Retake
                </button>
              </div>
            </div>
          ) : (
            <FaceCapture onCapture={setResult} captureLabel="Capture face" />
          )}
        </div>

        <div className="kxf-foot">
          <button type="button" className="kxf-btn kxf-btn--ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button type="button" className="kxf-btn kxf-btn--go" onClick={handleSubmit} disabled={!result || !email || working}>
            {working ? (<><span className="kxf-spin" /> Verifying…</>) : (<>Sign in with Face <i className="ri-arrow-right-line" /></>)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}