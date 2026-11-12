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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {kiosk ? <Kiosk token={kiosk[1]} /> : sched ? <Schedule slug={sched[1]} /> : <App />}
  </React.StrictMode>
);
