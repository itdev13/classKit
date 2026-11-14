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

  if (err) return <div className="kiosk"><div className="kiosk-card kiosk-msg"><h2>Kiosk unavailable</h2><p className="kiosk-sub">{err}</p></div></div>;
  if (!boot) return <div className="kiosk"><div className="spinner" /></div>;
  const { studio, sessions } = boot;

  return (
    <div className="kiosk" style={{ '--brand': studio.color }}>
      <header className="kiosk-head">
        <div className="kiosk-brand">
          {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <div className="kiosk-mark">{studio.name[0]}</div>}
          <div><h1>{studio.name}</h1><span>Front desk check-in</span></div>
        </div>
        <Clock tz={studio.timezone} />
      </header>

      <div className="kiosk-main">
        {result ? (
          <div className={`kiosk-card result ${result.ok ? 'ok' : 'bad'}`}>
            {result.ok ? (
              <>
                <div className="kiosk-tick"><svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></div>
                <h2>{result.alreadyCheckedIn ? `You're already in, ${result.firstName}!` : `Welcome, ${result.firstName}!`}</h2>
                <p className="kiosk-class">{result.className} · {fmtTime(result.startTime, studio.timezone)}</p>
                <div className="kiosk-pills">
                  <span>{result.credits === 'unlimited' ? 'Unlimited membership' : `${result.credits} class${result.credits === 1 ? '' : 'es'} left`}</span>
                  {result.visits > 1 && <span>Visit #{result.visits}</span>}
                </div>
                <p className="kiosk-sub">Enjoy your class!</p>
              </>
            ) : (
              <>
                <div className="kiosk-tick bad">!</div>
                <h2>We couldn't check you in</h2>
                <p className="kiosk-sub big">{result.message}</p>
                {!/front desk/i.test(result.message || '') && <p className="kiosk-sub">Check the number, or ask at the front desk.</p>}
              </>
            )}
            <button className="kiosk-done" onClick={reset}>{result.ok ? 'Done' : 'Try again'}</button>
            <div className="kiosk-timer" key={String(result.ok) + (result.firstName || result.message)}><div /></div>
          </div>
        ) : (
          <div className="kiosk-card">
            <h2>Check in for your class</h2>
            <p className="kiosk-sub">Enter the mobile number you booked with</p>
            <div className={`kiosk-display${digits ? '' : ' empty'}`} aria-live="polite">{digits ? pretty(digits) : '(555) 000-0000'}</div>
            <div className="kiosk-pad">
              {KEYS.map((k) => (
                <button key={k} className={`key ${k.length > 1 ? 'fn' : ''}`} onClick={() => press(k)} aria-label={k === 'back' ? 'Delete' : k}>
                  {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
                </button>
              ))}
            </div>
            <button className="kiosk-go" disabled={digits.length < 10 || busy} onClick={submit}>{busy ? 'Checking…' : 'Check in'}</button>
          </div>
        )}

        <aside className="kiosk-side">
          <h3>Classes starting soon</h3>
          {sessions.length === 0 ? (
            <div className="kiosk-none"><span>☾</span><p>No classes in the next hour.</p></div>
          ) : sessions.map((s) => {
            const pct = s.booked ? Math.round((s.attended / s.booked) * 100) : 0;
            return (
              <div className="kiosk-session" key={s.name + s.startTime}>
                <div className="ks-time">{fmtTime(s.startTime, studio.timezone)}</div>
                <div className="ks-main">
                  <strong>{s.name}</strong>
                  <div className="ks-bar"><div style={{ width: `${pct}%` }} /></div>
                  <small>{s.attended} of {s.booked} checked in</small>
                </div>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}

function Clock({ tz }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <div className="kiosk-clock">
      <strong>{fmtTime(now, tz)}</strong>
      <span>{new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || undefined }).format(now)}</span>
    </div>
  );
}
