import { useEffect, useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';

/**
 * Lightweight cookie consent banner. Renders only when:
 *   - Settings → Privacy → "Cookie Consent Banner" is ON
 *   - User hasn't already accepted (acceptance stored in localStorage)
 * Acceptance is browser-local; clearing browser data re-shows it.
 */
const ACCEPTED_KEY = 'cbc_cookies_accepted_v1';

export default function CookieBanner() {
  const { settings } = useSettings();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!settings.privacy.cookie) return;
    try {
      if (localStorage.getItem(ACCEPTED_KEY) !== '1') setShow(true);
    } catch {}
  }, [settings.privacy.cookie]);

  if (!show) return null;

  const accept = () => {
    try { localStorage.setItem(ACCEPTED_KEY, '1'); } catch {}
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 9999,
        maxWidth: 720, margin: '0 auto',
        background: '#0f172a', color: '#fff',
        borderRadius: 12, padding: '14px 16px',
        boxShadow: '0 14px 36px rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        animation: 'cbc-cookie-pop .3s ease',
      }}
    >
      <style>{`@keyframes cbc-cookie-pop { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <span style={{ fontSize: 22 }}>🍪</span>
      <div style={{ flex: 1, minWidth: 200, fontSize: 13, lineHeight: 1.5 }}>
        We use cookies to keep you signed in and remember your preferences. By continuing,
        you agree to our use of cookies.{' '}
        {settings.privacy.privacy_policy_url && (
          <a href={settings.privacy.privacy_policy_url} target="_blank" rel="noreferrer" style={{ color: '#7dd3fc', fontWeight: 600 }}>Privacy Policy</a>
        )}
      </div>
      <button
        type="button"
        onClick={accept}
        style={{
          background: 'linear-gradient(135deg,#10b981,#0ea5e9)',
          color: '#fff', border: 'none',
          padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
          fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 12px rgba(14,165,233,0.45)',
        }}
      >
        Accept
      </button>
    </div>
  );
}
