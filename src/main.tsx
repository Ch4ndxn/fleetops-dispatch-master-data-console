import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ── Hash-based routing for field technician tracker ───────────────
// The dispatcher app uses tab-state navigation (no URL changes).
// The tech tracking page is shared as a link opened on their phones.
// A simple hash check avoids adding react-router as a dependency.
//
// Dispatcher app:     https://your-app.com/
// Tech tracking page: https://your-app.com/#/track
//                     https://your-app.com/#/track?eid=EMP001

if (window.location.hash.startsWith('#/track')) {
  import('./components/tracking/TechTrackerPage').then(({ TechTrackerPage }) => {
    createRoot(document.getElementById('root')!).render(<TechTrackerPage />);
  });
} else {
  createRoot(document.getElementById('root')!).render(<App />);
}
