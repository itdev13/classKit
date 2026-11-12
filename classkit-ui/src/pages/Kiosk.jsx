import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtTime } from '../lib/format.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

function pretty(d) {
  const x = d.slice(0, 10);
  if (x.length <= 3) return x;
  if (x.length <= 6) return `(${x.slice(0, 3)}) ${x.slice(3)}`;
  return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`;
}

/** Front-desk tablet. Members type their mobile number and get checked into their class. */
export default function Kiosk({ token }) {
  const [boot, setBoot] = useState(null);
  const [err, setErr] = useState('');
  const [digits, setDigits] = useState('');
  const [result, setResult] = useState(null); // { ok, ... } | { ok:false, message }
  const [busy, setBusy] = useState(false);
  const resetTimer = useRef(null);

  const load = useCallback(() => api.kiosk(token).then(setBoot).catch((e) => setErr(e.message)), [token]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const reset = () => { setDigits(''); setResult(null); };
  const showResult = (r) => {
    setResult(r);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(reset, r.ok ? 5000 : 6000);
  };

  const submit = async () => {
    if (digits.length < 10 || busy) return;
    setBusy(true);
    try {
      const r = await api.kioskCheckIn(token, digits);
      showResult({ ok: true, ...r });
      load();
    } catch (e) {
      showResult({ ok: false, message: e.message });
    } finally { setBusy(false); }
  };

  const press = (k) => {
    if (result) reset();
    if (k === 'clear') return setDigits('');
    if (k === 'back') return setDigits((d) => d.slice(0, -1));
    setDigits((d) => (d.length >= 10 ? d : d + k));
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (err) return <div className="kiosk"><div className="kiosk-card"><h1>Kiosk unavailable</h1><p>{err}</p></div></div>;
  if (!boot) return <div className="kiosk"><div className="spinner" /></div>;
  const { studio, sessions } = boot;
  const accent = { '--brand': studio.color };

  return (
    <div className="kiosk" style={accent}>
      <header className="kiosk-head">
        {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <div className="kiosk-mark">{studio.name[0]}</div>}
        <h1>{studio.name}</h1>
      </header>

      <div className="kiosk-main">
        {result ? (
          <div className={`kiosk-card result ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok ? (
              <>
                <div className="kiosk-tick">✓</div>
                <h2>{result.alreadyCheckedIn ? `You're already in, ${result.firstName}!` : `Welcome, ${result.firstName}!`}</h2>
                <p className="kiosk-class">{result.className} · {fmtTime(result.startTime, studio.timezone)}</p>
                <p className="kiosk-credits">{result.credits === 'unlimited' ? 'Unlimited membership' : `${result.credits} class${result.credits === 1 ? '' : 'es'} left`}</p>
                {result.visits > 1 && <p className="kiosk-visits">Visit #{result.visits}. Enjoy your class!</p>}
              </>
            ) : (
              <>
                <h2>Hmm, not quite</h2>
                <p>{result.message}</p>
              </>
            )}
            <button className="kiosk-done" onClick={reset}>Done</button>
          </div>
        ) : (
          <div className="kiosk-card">
            <h2>Check in</h2>
            <p className="kiosk-sub">Enter the mobile number you booked with</p>
            <div className="kiosk-display" aria-live="polite">{digits ? pretty(digits) : <span className="ph">(555) 000-0000</span>}</div>
            <div className="kiosk-pad">
              {KEYS.map((k) => (
                <button key={k} className={`key ${k.length > 1 ? 'fn' : ''}`} onClick={() => press(k)} aria-label={k}>
                  {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
                </button>
              ))}
            </div>
            <button className="kiosk-go" disabled={digits.length < 10 || busy} onClick={submit}>{busy ? 'Checking…' : 'Check in'}</button>
          </div>
        )}

        <aside className="kiosk-side">
          <h3>Classes now</h3>
          {sessions.length === 0 ? <p className="kiosk-sub">No classes in the next hour.</p> : sessions.map((s) => (
            <div className="kiosk-session" key={s.name + s.startTime}>
              <strong>{fmtTime(s.startTime, studio.timezone)}</strong>
              <span>{s.name}</span>
              <small>{s.attended}/{s.booked} here</small>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
