import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect } from '../../../components/ui/MasterSelect';

/* ────────────────────────────────────────────────────────────────────────────
 * Change Lead Owner — reassigns an opportunity to a different team
 * member. Surfaces the current owner at top, a dropdown of candidate
 * owners below, and an Update Owner action. Frontend-only for now;
 * once the backend is wired, replace `SAMPLE_OWNERS` with a fetch
 * from /sales/team-members (or equivalent).
 * ──────────────────────────────────────────────────────────────────────── */

export type OwnerOption = { value: string; label: string };

const SAMPLE_OWNERS: OwnerOption[] = [
  { value: 'shreeyash',  label: 'Shreeyash Rajaram Mote' },
  { value: 'durgesh',    label: 'Durgesh Urkude' },
  { value: 'bhavika',    label: 'Bhavika' },
  { value: 'rahul',      label: 'Rahul Sharma' },
  { value: 'priya',      label: 'Priya Mehta' },
  { value: 'ankit',      label: 'Ankit Verma' },
  { value: 'sneha',      label: 'Sneha Patil' },
];

export default function ChangeOwnerModal(props: {
  open: boolean;
  /** Current owner display name, or `Unassigned` if none. */
  currentOwner?: string;
  /** Live owner candidates — falls back to SAMPLE_OWNERS for the mock. */
  owners?: OwnerOption[];
  onClose: () => void;
  onUpdate?: (newOwner: OwnerOption) => void;
}) {
  const { open, currentOwner = 'Unassigned', owners = SAMPLE_OWNERS, onClose, onUpdate } = props;
  const toast = useToast();
  const [selected, setSelected] = useState<string>('');

  useEffect(() => { if (open) setSelected(''); }, [open]);

  // Body scroll lock — keep the page behind the modal from scrolling while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const handleUpdate = () => {
    if (!selected) {
      toast.error('Pick a team member', 'Select a new owner before updating');
      return;
    }
    const opt = owners.find(o => o.value === selected);
    if (!opt) return;
    if (onUpdate) onUpdate(opt);
    toast.success('Owner updated', `Reassigned to ${opt.label}`);
    onClose();
  };

  const isUnassigned = !currentOwner || currentOwner === 'Unassigned';

  return createPortal((
    <div className="com-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="com-modal" onClick={(e) => e.stopPropagation()}>
        <div className="com-head">
          <div className="com-head-left">
            <div className="com-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <polyline points="17 11 19 13 23 9" />
              </svg>
            </div>
            <div>
              <div className="com-head-title">Change Lead Owner</div>
              <div className="com-head-sub">Reassign this opportunity to a new team member</div>
            </div>
          </div>
          <button className="com-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="com-body">
          {/* Current owner card */}
          <div className="com-current">
            <div className={`com-current-avatar ${isUnassigned ? 'com-current-avatar-q' : ''}`}>
              {isUnassigned ? <span aria-hidden>?</span> : <span>{currentOwner.charAt(0).toUpperCase()}</span>}
            </div>
            <div className="com-current-meta">
              <div className="com-current-label">Current Owner</div>
              <div className="com-current-name">{currentOwner}</div>
            </div>
            {isUnassigned && <span className="com-unassigned-pill">Unassigned</span>}
          </div>

          {/* Down arrow */}
          <div className="com-arrow-wrap">
            <div className="com-arrow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </div>
          </div>

          {/* New owner select */}
          <div className="com-field">
            <label className="com-field-label">
              Select New Owner <span className="com-req">*</span>
            </label>
            <MasterSelect
              value={selected}
              onChange={setSelected}
              options={owners}
              placeholder="Select team member"
            />
          </div>
        </div>

        <div className="com-foot">
          <button className="com-btn-ghost" onClick={onClose}>Close</button>
          <button className="com-btn-primary" onClick={handleUpdate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <polyline points="17 11 19 13 23 9" />
            </svg>
            Update Owner
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.com-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: var(--font-sans);
}
.com-modal {
  margin: auto;
  width: 100%; max-width: 580px;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
}
.com-modal *, .com-modal *::before, .com-modal *::after { box-sizing: border-box; }

.com-head {
  /* Lighter 4-stop violet sweep matching the prototype + the rest of
     the matrix modals (Product Directory, Map Product form). */
  position: relative;
  padding: 16px 22px;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  overflow: hidden; flex-shrink: 0;
}
.com-head::after {
  content: ''; position: absolute;
  top: -40%; right: -10%; width: 280px; height: 220px;
  background: radial-gradient(ellipse, rgba(255,255,255,.18), transparent 70%);
  pointer-events: none;
}
.com-head-left { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.com-head-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.com-head-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.com-head-sub   { font-size: 12px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 2px; }
.com-close {
  width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
  position: relative; z-index: 1;
}
.com-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

.com-body {
  padding: 22px;
  background: linear-gradient(180deg, #faf5ff 0%, #ffffff 100%);
  display: flex; flex-direction: column; gap: 6px;
}

/* Current owner card */
.com-current {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #ede9fe;
  border-radius: 12px;
  box-shadow: 0 1px 4px rgba(124, 58, 237, .06);
}
.com-current-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: #f1f5f9;
  display: inline-flex; align-items: center; justify-content: center;
  color: #5b21b6;
  font-size: 18px; font-weight: 700;
  flex-shrink: 0;
}
/* Question-mark avatar — quiet slate fill with a bold "?" glyph for
   the Unassigned state, matching the prototype. */
.com-current-avatar-q {
  background: #e2e8f0;
  color: #64748b;
  font-size: 22px; font-weight: 800;
  line-height: 1;
}
.com-current-meta { flex: 1; min-width: 0; }
.com-current-label {
  font-size: 10px; font-weight: 700; letter-spacing: .08em;
  color: #94a3b8; text-transform: uppercase;
}
.com-current-name {
  font-size: 14px; font-weight: 700; color: #1e1b4b;
  margin-top: 3px;
}
.com-unassigned-pill {
  padding: 4px 12px; border-radius: 999px;
  background: #ede9fe; color: #6d28d9;
  font-size: 11px; font-weight: 600;
  border: 1px solid #ddd6fe;
}

/* Vertical arrow link */
.com-arrow-wrap {
  display: flex; align-items: center; justify-content: center;
  padding: 10px 0;
  position: relative;
}
.com-arrow-wrap::before,
.com-arrow-wrap::after {
  content: ''; position: absolute; top: 50%;
  height: 1px; width: 35%;
  background: linear-gradient(90deg, transparent, #ddd6fe, transparent);
}
.com-arrow-wrap::before { left: 0; }
.com-arrow-wrap::after  { right: 0; }
.com-arrow {
  /* Rounded square (was a full circle) matching the prototype's
     "flow-step" chip silhouette. */
  width: 34px; height: 34px; border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
  position: relative;
}

/* Field */
.com-field { display: flex; flex-direction: column; gap: 8px; }
.com-field-label {
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #5b21b6;
}
.com-req { color: #f06548; font-weight: 600; }
.com-select-wrap { position: relative; }
.com-select {
  width: 100%; height: 42px;
  padding: 8px 36px 8px 14px;
  appearance: none; -webkit-appearance: none;
  border: 1.5px solid #ddd6fe;
  border-radius: 10px;
  background: #fff;
  color: #1e1b4b;
  font-family: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.com-select:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}
.com-select-arrow {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  font-size: 18px; color: #7c3aed; pointer-events: none;
}

/* Footer */
.com-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #ede9fe;
}
.com-btn-ghost, .com-btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 16px;
  border-radius: 9px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .12s, box-shadow .15s;
}
.com-btn-ghost {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  color: #475569;
}
.com-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }
.com-btn-primary {
  border: none;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.com-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124, 58, 237, .45); }

/* Dark mode */
[data-bs-theme="dark"] .com-modal { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .com-body  { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); }
[data-bs-theme="dark"] .com-foot  { background: #1a1538; border-top-color: #2a2150; }
[data-bs-theme="dark"] .com-current {
  background: #1a1538; border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .com-current-avatar { background: #2a2150; color: #c4b5fd; }
[data-bs-theme="dark"] .com-current-label  { color: #c4b5fd; }
[data-bs-theme="dark"] .com-current-name   { color: #ede9fe; }
[data-bs-theme="dark"] .com-unassigned-pill { background: #2a2150; color: #94a3b8; border-color: rgba(167, 139, 250, .25); }
[data-bs-theme="dark"] .com-arrow-wrap::before,
[data-bs-theme="dark"] .com-arrow-wrap::after { background: linear-gradient(90deg, transparent, rgba(167, 139, 250, .35), transparent); }
[data-bs-theme="dark"] .com-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .com-select { background: #2a2150; border-color: rgba(167, 139, 250, .35); color: #ede9fe; }
[data-bs-theme="dark"] .com-select-arrow { color: #c4b5fd; }
[data-bs-theme="dark"] .com-btn-ghost { background: transparent; color: #cbd5e1; border-color: #3b2a6b; }
[data-bs-theme="dark"] .com-btn-ghost:hover { background: #2a2150; border-color: #4338ca; }
`;
