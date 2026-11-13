import React, { useCallback, useEffect, useState } from 'react';
import { BrandMark } from './components/BrandEditor.jsx';
import { setCurrency } from './lib/format.js';
import { api, setToken, setRefreshHandler } from './lib/api.js';
import { Icon, Spinner, Toast } from './components/ui.jsx';
import SetupWizard from './pages/SetupWizard.jsx';
import Today from './pages/Today.jsx';
import Members from './pages/Members.jsx';
import Packages from './pages/Packages.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

/** Ask the GHL parent frame for the encrypted user context (Custom Page SSO). */
function requestGhlUserData() {
  return new Promise((resolve, reject) => {
    if (window.parent === window) return reject(new Error('not embedded'));
    const timer = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('no parent')); }, 1500);
    function handler(e) {
      if (e.data?.message === 'REQUEST_USER_DATA_RESPONSE') {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(e.data.payload);
      }
    }
    window.addEventListener('message', handler);
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  });
}

async function handshake() {
  const devLocation = new URLSearchParams(window.location.search).get('locationId');
  let encryptedData = null;
  try { encryptedData = await requestGhlUserData(); } catch { /* not embedded */ }
  if (!encryptedData && !devLocation) return null;
  return api.verify(encryptedData ? { encryptedData } : { locationId: devLocation });
}

/** Studio colour → the app's accent variables (hover and soft tints derived from it). */
function brandVars(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '') || color.toLowerCase() === '#5b4bdb') return undefined;
  return {
    '--accent': color,
    '--accent-dk': `color-mix(in srgb, ${color} 82%, black)`,
    '--accent-soft': `color-mix(in srgb, ${color} 12%, white)`
  };
}

const TABS = [
  { id: 'today', label: 'Classes', icon: 'calendar' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'packages', label: 'Packages', icon: 'ticket' },
  { id: 'reports', label: 'Reports', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'gear', admin: true }
];

export default function App() {
  const [phase, setPhase] = useState('loading');
  const [session, setSession] = useState(null);
  const [view, setView] = useState('today');
  const [openMember, setOpenMember] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');

  const notify = useCallback((message, isError = false) => setToast({ message, error: isError }), []);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    setRefreshHandler(async () => {
      try { const r = await handshake(); if (r?.token) { setToken(r.token); return true; } } catch { /* ignore */ }
      return false;
    });
  }, []);

  const boot = useCallback(async () => {
    setPhase('loading');
    try {
      const r = await handshake();
      if (!r) { setPhase('connect'); return; }
      setToken(r.token);
      setCurrency(r.workspace.currency);
      setSession(r);
      setPhase(r.workspace.setupComplete ? 'app' : 'wizard');
    } catch (e) {
      if (e.status === 403) setPhase('connect');
      else { setError(e.message); setPhase('error'); }
    }
  }, []);
  useEffect(() => { boot(); }, [boot]);

  if (phase === 'loading') return <Spinner />;
  if (phase === 'connect' || phase === 'error') {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <img src="/icon.svg" alt="" width="52" height="52" />
          <h2>{phase === 'error' ? 'Something went wrong' : 'Install ClassKit'}</h2>
          <p className="muted">{phase === 'error' ? error : 'Open ClassKit from your sub-account menu after installing it from the marketplace.'}</p>
          {phase === 'error' ? <button className="btn primary" onClick={boot}>Try again</button> : <a className="btn primary" href={api.authorizeUrl()} target="_blank" rel="noreferrer">Install ClassKit</a>}
        </div>
      </div>
    );
  }

  const isAdmin = session?.user?.role === 'admin';
  const tz = session?.workspace?.timezone;

  if (phase === 'wizard') {
    return (
      <>
        <SetupWizard isAdmin={isAdmin} notify={notify} onDone={() => { setPhase('app'); notify('ClassKit is live'); }} />
        <Toast toast={toast} onDone={clearToast} />
      </>
    );
  }

  const goMember = (contactId) => { setOpenMember(contactId); setView('members'); };

  return (
    <div className="shell" style={brandVars(session?.workspace?.brand?.color)}>
      <header className="topnav">
        <div className="brand">
          <BrandMark brand={session?.workspace?.brand} fallbackName={session?.workspace?.locationName} size={30} />
          <div><strong>{session?.workspace?.brand?.name || session?.workspace?.locationName || 'Your studio'}</strong><small>ClassKit{isAdmin ? '' : ' · Staff'}</small></div>
        </div>
        <nav className="tabs">
          {TABS.filter((t) => !t.admin || isAdmin).map((t) => (
            <button key={t.id} className={`tab ${view === t.id ? 'active' : ''}`} onClick={() => { setView(t.id); if (t.id !== 'members') setOpenMember(null); }}>
              <Icon name={t.icon} /> {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {view === 'today' && <Today tz={tz} notify={notify} onOpenMember={goMember} />}
        {view === 'members' && <Members tz={tz} notify={notify} openId={openMember} setOpenId={setOpenMember} />}
        {view === 'packages' && <Packages isAdmin={isAdmin} notify={notify} />}
        {view === 'reports' && <Reports tz={tz} onOpenMember={goMember} />}
        {view === 'settings' && isAdmin && <Settings notify={notify} onSaved={(st) => setSession((cur) => ({ ...cur, workspace: { ...cur.workspace, brand: st.brand, locationName: st.brand?.name || st.locationName || cur.workspace.locationName } }))} />}
      </main>
      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
