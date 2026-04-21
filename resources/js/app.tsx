import '../css/app.css';
import '../scss/velzon.scss';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { createRoot } from 'react-dom/client';
import App from './components/App';

const container = document.getElementById('app');
if (container) {
    createRoot(container).render(<App />);
}
