import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fromNow, money } from '../lib/format.js';
import { Avatar, Credits, Empty, Spinner } from '../components/ui.jsx';

const RANGES = [7, 30, 90];

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export default function Reports({ onOpenMember }) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setR(null); api.report(days).then((x) => setR(x.report)).catch((e) => setErr(e.message)); }, [days]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Reports</h1><p className="muted">How your classes and packages are doing.</p></div>
        <div className="seg">{RANGES.map((d) => <button key={d} className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>{d} days</button>)}</div>
      </div>
      {err && <p className="warn-text">{err}</p>}
      {!r ? <Spinner full={false} /> : (
        <>
          <div className="stats">
            <Stat label="Package revenue" value={money(r.revenueUsd)} sub={`${r.packsSold} packages sold online`} />
            <Stat label="Check-ins" value={r.attended} sub={`${r.sessions} classes held`} />
            <Stat label="Fill rate" value={r.fillRate == null ? '—' : `${r.fillRate}%`} sub="seats booked vs capacity" />
            <Stat label="No-show rate" value={`${r.noShowRate}%`} sub={`${r.noShows} no-shows · ${r.lateCancels} late cancels`} tone={r.noShowRate > 15 ? 'warn' : ''} />
          </div>
          <div className="stats">
            <Stat label="Active members" value={r.activeMembers} sub="with credits or unlimited" />
            <Stat label="Credits sold" value={r.creditsSold} sub={`${r.creditsUsed} used · ${r.creditsRefunded} refunded`} />
            <Stat label="Unused credits" value={r.outstandingCredits} sub={`${money(r.liabilityUsd)} prepaid, not yet used`} />
            <Stat label="Expiring in 14 days" value={r.expiringSoon} sub={`${r.creditsExpired} expired this period`} tone={r.expiringSoon ? 'warn' : ''} />
          </div>

          <div className="two-col">
            <section className="card">
              <h3>Classes</h3>
              {r.perClass.length === 0 ? <p className="muted small">No classes in this period.</p> : (
                <table className="table">
                  <thead><tr><th>Class</th><th className="num">Sessions</th><th className="num">Seats</th><th className="num">Fill</th></tr></thead>
                  <tbody>{r.perClass.map((c) => (
                    <tr key={c.name}><td>{c.name}</td><td className="num">{c.sessions}</td><td className="num">{c.seats}</td>
                      <td className="num"><div className="fill-cell"><div className="bar slim"><div style={{ width: `${Math.min(100, c.fillRate || 0)}%` }} /></div>{c.fillRate == null ? '—' : `${c.fillRate}%`}</div></td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
            <section className="card">
              <h3>At risk</h3>
              <p className="muted small">Have credits but haven't visited in 14+ days. A quick text often brings them back.</p>
              {r.atRisk.length === 0 ? <Empty title="Nobody at risk">Everyone with credits has been in recently.</Empty> : (
                <ul className="member-list compact">
                  {r.atRisk.map((m) => (
                    <li key={m.contactId}><button onClick={() => onOpenMember(m.contactId)}>
                      <Avatar name={m.name} size={28} /><span className="grow"><strong>{m.name}</strong><small>Last visit {fromNow(m.lastVisitAt)}</small></span>
                      <Credits member={{ balance: m.balance, unlimitedUntil: m.unlimited ? new Date(Date.now() + 864e5) : null }} />
                    </button></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
