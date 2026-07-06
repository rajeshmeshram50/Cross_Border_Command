import '../css/app.css';
import '../scss/velzon.scss';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { createRoot } from 'react-dom/client';
import App from './components/App';
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
