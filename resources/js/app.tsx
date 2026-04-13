import '../css/app.css';
import { createRoot } from 'react-dom/client';
import App from './components/App';

const container = document.getElementById('app');
if (container) {
    createRoot(container).render(<App />);
}
