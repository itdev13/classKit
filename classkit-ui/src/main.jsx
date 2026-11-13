import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Kiosk from './pages/Kiosk.jsx';
import Schedule from './pages/Schedule.jsx';
import './styles.css';

// Three surfaces from one bundle: the embedded admin app, the front-desk kiosk, the public schedule.
const path = window.location.pathname;
const kiosk = path.match(/^\/kiosk\/([^/]+)/);
const sched = path.match(/^\/s\/([^/]+)/);

/** Never leave a blank page: show what broke and a way out. */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('ClassKit crashed', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Something went wrong</h2>
          <p className="muted">ClassKit hit an unexpected error. Reloading usually fixes it.</p>
          <code className="small">{String(this.state.error?.message || this.state.error).slice(0, 200)}</code>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {kiosk ? <Kiosk token={kiosk[1]} /> : sched ? <Schedule slug={sched[1]} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
