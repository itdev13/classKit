import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDay, fmtTime } from '../lib/format.js';

/** Public class schedule: book open classes (GHL booking widget) or join the waitlist for full ones. */
export default function Schedule({ slug }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [join, setJoin] = useState(null);

  const load = () => api.schedule(slug).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => {
    const g = new Map();
    for (const s of data?.sessions || []) {
      const k = fmtDay(s.startTime, data.studio.timezone);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(s);
    }
    return [...g.entries()];
  }, [data]);

  if (err) return <div className="public"><div className="public-card"><h1>Schedule not available</h1><p>{err}</p></div></div>;
  if (!data) return <div className="public"><div className="spinner" /></div>;
  const { studio } = data;

  return (
    <div className="public" style={{ '--brand': studio.color }}>
      <header className="public-head">
        {studio.logoUrl ? <img src={studio.logoUrl} alt="" /> : <div className="kiosk-mark">{studio.name[0]}</div>}
        <div><h1>{studio.name}</h1><p>Class schedule · next 7 days</p></div>
        {data.buyUrl && <a className="public-buy" href={data.buyUrl} target="_blank" rel="noreferrer">Buy a class pack</a>}
      </header>

      {byDay.length === 0 ? <div className="public-card"><p>No classes scheduled this week.</p></div> : byDay.map(([day, list]) => (
        <section key={day} className="public-day">
          <h2>{day}</h2>
          {list.map((s) => (
            <div key={s.calendarId + s.startTime} className="public-row">
              <div className="public-time">{fmtTime(s.startTime, studio.timezone)}<small>{s.durationMins} min</small></div>
              <div className="public-name"><strong>{s.name}</strong><small>{s.creditCost === 1 ? '1 credit' : `${s.creditCost} credits`}</small></div>
              <div className="public-spots">{s.full ? <span className="full">Full</span> : <span>{s.spotsLeft} spot{s.spotsLeft === 1 ? '' : 's'} left</span>}</div>
              {s.full
                ? (data.waitlistEnabled ? <button className="public-btn ghost" onClick={() => setJoin(s)}>Join waitlist</button> : <span />)
                : <a className="public-btn" href={s.bookUrl} target="_blank" rel="noreferrer">Book</a>}
            </div>
          ))}
        </section>
      ))}

      {join && <JoinWaitlist slug={slug} session={join} tz={studio.timezone} onClose={() => setJoin(null)} />}
      <footer className="public-foot">Powered by ClassKit</footer>
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
