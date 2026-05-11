import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';

/**
 * Auto-logout after 30 minutes of inactivity when Settings → Security →
 * "Session Timeout (30 min)" is ON. Listens for mouse / keyboard / touch /
 * scroll events to detect activity; resets the timer on any.
 *
 * Mount-once component — must live INSIDE Auth + Settings providers so it
 * can read both. Renders nothing.
 */
const TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export default function IdleTimeout() {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const timerRef = useRef<number | null>(null);

  const enabled = !!user && settings.security.sessTimeout;

  useEffect(() => {
    if (!enabled) return;

    const reset = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(async () => {
        toast.info('Signed out', 'Your session timed out after 30 minutes of inactivity.');
        await logout();
      }, TIMEOUT_MS);
    };

    // Activity sensors — passive listeners so we don't impact scroll perf
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }));

    reset();  // start the timer now

    return () => {
      events.forEach(ev => window.removeEventListener(ev, reset));
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [enabled, logout, toast]);

  return null;
}
