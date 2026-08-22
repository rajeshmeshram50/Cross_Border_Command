import '../css/app.css';
import '../scss/velzon.scss';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import { mountBrowserSupportNotice } from './utils/browserSupport';
try {
    const root = document.documentElement;
    const seed = (key: string, attr: string, allowed?: readonly string[]) => {
        const v = window.localStorage.getItem(key);
        if (!v) return;
        if (allowed && !allowed.includes(v)) return;
        root.setAttribute(attr, v);
    };

    seed('cbc-layout-mode',     'data-bs-theme',         ['light', 'dark']);
    seed('cbc-layout',          'data-layout',           ['vertical', 'horizontal', 'twocolumn', 'semibox']);
    seed('cbc-sidebar-theme',   'data-sidebar');
    seed('cbc-layout-width',    'data-layout-width',     ['fluid', 'boxed']);
    seed('cbc-layout-position', 'data-layout-position',  ['fixed', 'scrollable']);
    seed('cbc-topbar-theme',    'data-topbar',           ['light', 'dark']);
    seed('cbc-sidebar-size',    'data-sidebar-size',     ['lg', 'md', 'sm', 'sm-hover']);
    seed('cbc-sidebar-view',    'data-layout-style',     ['default', 'detached']);
    seed('cbc-sidebar-image',   'data-sidebar-image');
} catch { /* localStorage blocked (private mode etc) — fall back to defaults */ }

/* Warn before mounting, not after (QA #108).
 *
 * On a browser below the CSS floor the app still renders and still works — it
 * just loses every colour and spacing rule, which reads as a broken page rather
 * than an old browser. Running this first means the explanation is on screen
 * even if something later in the boot fails, and it is deliberately outside the
 * React tree so it does not depend on the app mounting successfully at all.
 *
 * No-op on a supported browser. Wrapped because a diagnostic must never be the
 * thing that stops the application from starting. */
try {
    mountBrowserSupportNotice();
} catch { /* never let the notice break the boot */ }

const container = document.getElementById('app');
if (container) {
    createRoot(container).render(<App />);
}
