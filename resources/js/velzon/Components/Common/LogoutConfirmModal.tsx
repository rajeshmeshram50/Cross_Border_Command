import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/* "Log out?" confirmation for the vertical / two-column header.
 *
 * Same card as the horizontal header's modal (IdimsHeader.tsx, .idims-logout-*)
 * so logging out asks the same question in every layout. Before this, the
 * sidebar layouts signed the user out on the first click of the topbar icon or
 * the profile-menu item, with no way back from a misclick.
 *
 * Portalled to <body>: the topbar is position:fixed, and a fixed overlay
 * rendered inside it would be clipped to the header's stacking context. */
interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const LogoutConfirmModal = ({ open, onCancel, onConfirm }: Props) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="cbc-logout-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <style>{`
        .cbc-logout-overlay { position: fixed; inset: 0; z-index: 1060; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.42); backdrop-filter: blur(5px); animation: cbcLogoutFade .2s ease; }
        @keyframes cbcLogoutFade { from { opacity: 0; } to { opacity: 1; } }
        .cbc-logout-modal { width: 100%; max-width: 380px; border-radius: 22px; overflow: hidden; background: #fff; border: 1px solid transparent; text-align: center; padding: 30px 28px 24px; box-shadow: 0 30px 80px rgba(15,23,42,.32); position: relative; animation: cbcLogoutPop .32s cubic-bezier(.34,1.56,.64,1); }
        @keyframes cbcLogoutPop { from { opacity: 0; transform: translateY(14px) scale(.94); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .cbc-logout-modal::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg,#FB7185,#F43F5E 55%,#E11D48); }
        .cbc-logout-icon { width: 70px; height: 70px; border-radius: 20px; margin: 4px auto 18px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#FFE4E6,#FECDD3); box-shadow: 0 8px 22px rgba(244,63,94,.22); }
        .cbc-logout-title { font-size: 18px; font-weight: 800; color: #0F172A; margin-bottom: 7px; }
        .cbc-logout-text { font-size: 13px; color: #64748B; line-height: 1.5; margin-bottom: 24px; }
        .cbc-logout-actions { display: flex; gap: 12px; }
        .cbc-logout-actions button { flex: 1; height: 46px; border-radius: 13px; font-family: var(--font-sans); font-size: 13.5px; font-weight: 700; cursor: pointer; border: none; transition: transform .14s, box-shadow .18s, background .18s; }
        .cbc-logout-actions button:active { transform: scale(.97); }
        .cbc-logout-cancel { background: #F1F3F9; color: #475569; border: 1.5px solid #E7EAF3 !important; }
        .cbc-logout-cancel:hover { background: #E9ECF3; color: #1E293B; }
        .cbc-logout-confirm { color: #fff; background: linear-gradient(135deg,#F43F5E,#E11D48); box-shadow: 0 6px 16px rgba(225,29,72,.35); }
        .cbc-logout-confirm:hover { box-shadow: 0 8px 22px rgba(225,29,72,.45); transform: translateY(-1px); }
        [data-bs-theme="dark"] .cbc-logout-modal { background: #171A23; border-color: #262B38; }
        [data-bs-theme="dark"] .cbc-logout-title { color: #F1F5F9; }
        [data-bs-theme="dark"] .cbc-logout-text { color: #9CA3AF; }
        [data-bs-theme="dark"] .cbc-logout-cancel { background: #232838; color: #CBD5E1; border-color: #2C3242 !important; }
      `}</style>
      <div className="cbc-logout-modal" role="dialog" aria-modal="true" aria-labelledby="cbc-logout-title">
        <div className="cbc-logout-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="#E11D48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 32, height: 32 }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
        </div>
        <div className="cbc-logout-title" id="cbc-logout-title">Log out?</div>
        <div className="cbc-logout-text">Are you sure you want to log out? You'll need to sign in again to continue.</div>
        <div className="cbc-logout-actions">
          <button type="button" className="cbc-logout-cancel" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="cbc-logout-confirm" onClick={onConfirm}>Log Out</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LogoutConfirmModal;
