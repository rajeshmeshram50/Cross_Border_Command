import '../css/app.css';
import '../scss/velzon.scss';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { createRoot } from 'react-dom/client';
import App from './components/App';

// Apply every persisted layout choice BEFORE React mounts. Without this
// the page paints once in the default layout (vertical / light / lg etc)
// and then snaps to the user's saved choice when the Layout's useEffect
// runs — a visible flash on every refresh. Reading localStorage is
// synchronous and cheap so it's safe to do at the very top of bootstrap.
//
// Keys here MUST match the writes in
// `resources/js/velzon/slices/layouts/thunk.ts` and the reads in
// `resources/js/velzon/slices/layouts/reducer.ts`.
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

const container = document.getElementById('app');
if (container) {
    createRoot(container).render(<App />);
}
