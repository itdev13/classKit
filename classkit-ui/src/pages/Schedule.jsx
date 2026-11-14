import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDay, fmtTime } from '../lib/format.js';

/** Public class schedule: book open classes (GHL booking widget) or join the waitlist for full ones. */
export default function Schedule({ slug }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [join, setJoin] = useState(null);
  const [pick, setPick] = useState(null);
  const embed = new URLSearchParams(window.location.search).has('embed');

  const load = () => api.schedule(slug).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => {
    const g = new Map();
    for (const s of data?.sessions || []) {
      const tz = data.studio.timezone;
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined }).format(new Date(s.startTime));
      if (!g.has(key)) g.set(key, { key, first: s.startTime, list: [] });
      g.get(key).list.push(s);
    }
    return [...g.values()];
  }, [data]);

  if (err) return <div className="public"><div className="public-card"><h2>Schedule not available</h2><p className="muted">{err}</p></div></div>;
  if (!data) return <div className="public"><div className="spinner" /></div>;
  const { studio } = data;
  const tz = studio.timezone;
  const current = days.find((d) => d.key === pick) || days[0];
  const wd = (d) => new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: tz || undefined }).format(new Date(d));
  const dn = (d) => new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: tz || undefined }).format(new Date(d));

  return (
    <div className={`public${embed ? ' embed' : ''}`} style={{ '--brand': studio.color }}>
      <header className="public-hero">
        <div className="public-id">
          {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <div className="kiosk-mark">{studio.name[0]}</div>}
          <div><h1>{studio.name}</h1><p>Book a class · next 7 days</p></div>
        </div>
        {data.buyUrl && <a className="public-buy" href={data.buyUrl} target="_blank" rel="noreferrer">Buy a class pack</a>}
      </header>

      {days.length === 0 ? (
        <div className="public-card"><div className="public-empty">☾</div><h3>No classes this week</h3><p className="muted">New classes will show up here as soon as they're scheduled.</p></div>
      ) : (
        <>
          <nav className="public-days" aria-label="Choose a day">
            {days.map((d) => (
              <button key={d.key} className={d.key === current.key ? 'on' : ''} onClick={() => setPick(d.key)}>
                <span>{wd(d.first)}</span><b>{dn(d.first)}</b><small>{d.list.length} class{d.list.length === 1 ? '' : 'es'}</small>
              </button>
            ))}
          </nav>

          <h2 className="public-dayname">{fmtDay(current.first, tz)}</h2>
          <div className="public-list">
            {current.list.map((s) => {
              const cap = s.capacity || (s.spotsLeft != null ? s.spotsLeft + (s.booked || 0) : null);
              const pct = cap ? Math.min(100, Math.round(((cap - (s.spotsLeft ?? 0)) / cap) * 100)) : 0;
              const tone = s.full ? 'full' : s.spotsLeft <= 2 ? 'few' : 'open';
              return (
                <div key={s.calendarId + s.startTime} className="public-row">
                  <div className="public-time"><b>{fmtTime(s.startTime, tz)}</b><small>{s.durationMins} min</small></div>
                  <div className="public-name">
                    <strong>{s.name}</strong>
                    <small>{s.creditCost === 1 ? '1 credit' : `${s.creditCost} credits`}</small>
                  </div>
                  <div className={`public-spots ${tone}`}>
                    <span>{s.full ? 'Class full' : `${s.spotsLeft} spot${s.spotsLeft === 1 ? '' : 's'} left`}</span>
                    {cap ? <div className="spots-bar"><div style={{ width: `${pct}%` }} /></div> : null}
                  </div>
                  {s.full
                    ? (data.waitlistEnabled ? <button className="public-btn ghost" onClick={() => setJoin(s)}>Join waitlist</button> : <span className="public-btn disabled">Full</span>)
                    : <a className="public-btn" href={s.bookUrl} target="_blank" rel="noreferrer">Book</a>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {join && <JoinWaitlist slug={slug} session={join} tz={tz} onClose={() => setJoin(null)} />}
      {!embed && <footer className="public-foot">Powered by ClassKit</footer>}
    </div>
  );
}

function JoinWaitlist({ slug, session, tz, onClose }) {
  const [f, setF] = useState({ name: '', phone: '', email: '' });
  const [state, setState] = useState({ busy: false, done: null, err: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim() || f.phone.replace(/\D/g, '').length < 7) {
      setState({ busy: false, done: null, err: 'Enter your name and mobile number' });
      return;
    }
    setState({ busy: true, done: null, err: '' });
    try {
      const r = await api.joinWaitlist(slug, { calendarId: session.calendarId, startTime: session.startTime, ...f });
      setState({ busy: false, done: r, err: '' });
    } catch (er) { setState({ busy: false, done: null, err: er.message }); }
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal public-modal" role="dialog" aria-modal="true">
        {state.done ? (
          <>
            <h3>{state.done.position === 0 ? `You're booked, ${state.done.firstName}!` : `You're #${state.done.position} on the list`}</h3>
            <p>{state.done.position === 0 ? 'A spot was free, so we booked you in.' : "We'll text you the moment a spot opens and book you in automatically. You need a class credit for it."}</p>
            <button className="public-btn" onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h3>Join the waitlist</h3>
            <p className="muted">{session.name} · {fmtDay(session.startTime, tz)}, {fmtTime(session.startTime, tz)}</p>
            <label className="field"><span className="field-label">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
            <label className="field"><span className="field-label">Mobile</span><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
            <label className="field"><span className="field-label">Email (optional)</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            {state.err && <p className="warn-text small">{state.err}</p>}
            <div className="row gap end"><button type="button" className="public-btn ghost" onClick={onClose}>Cancel</button><button className="public-btn" disabled={state.busy}>{state.busy ? 'Joining…' : 'Join waitlist'}</button></div>
          </form>
        )}
      </div>
    </div>
  );
}
