import '../css/app.css';
import '../scss/velzon.scss';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { createRoot } from 'react-dom/client';
import App from './components/App';

// Apply the persisted theme BEFORE React mounts. Without this the page
// paints once in light mode and then snaps to dark when the Layout's
// useEffect runs — a visible flash on every refresh. Reading localStorage
// is synchronous and cheap so it's safe to do at the very top of bootstrap.
try {
    const mode = window.localStorage.getItem('cbc-layout-mode');
    if (mode === 'dark' || mode === 'light') {
        document.documentElement.setAttribute('data-bs-theme', mode);
    }
} catch { /* localStorage blocked (private mode etc) — fall back to default */ }

const container = document.getElementById('app');
if (container) {
    createRoot(container).render(<App />);
}
