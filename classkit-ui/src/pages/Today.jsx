import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtTime, fmtDay, isUnlimited, startOfDayTz, addDaysTz, toZonedInput, fromZonedInput } from '../lib/format.js';
import { Avatar, Badge, Empty, Icon, Modal, Spinner, Field } from '../components/ui.jsx';
import MemberPicker from '../components/MemberPicker.jsx';

const STATUS = {
  booked: { label: 'Booked', tone: 'neutral' },
  attended: { label: 'Checked in', tone: 'good' },
  noshow: { label: 'No-show', tone: 'crit' }
};

export default function Today({ tz, notify, onOpenMember }) {
  const [day, setDay] = useState(() => startOfDayTz(new Date(), tz));
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [bookFor, setBookFor] = useState(null); // { calendarId, startTime, name } | { blank: true }

  const load = useCallback(async () => {
    try {
      const r = await api.classes(day, addDaysTz(day, 1, tz));
      setSessions(r.sessions);
    } catch (e) { notify(e.message, true); setSessions([]); }
  }, [day, tz, notify]);

  useEffect(() => { setSessions(null); load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    const f = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', f);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', f); };
  }, [load]);

  const act = async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); notify(ok); await load(); } catch (e) { notify(e.message, true); } finally { setBusy(null); }
  };

  const isToday = +day === +startOfDayTz(new Date(), tz);
  const totals = (sessions || []).reduce((a, s) => ({ booked: a.booked + s.booked, attended: a.attended + s.attended }), { booked: 0, attended: 0 });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isToday ? 'Today' : fmtDay(day, tz)}</h1>
          <p className="muted">{sessions ? `${sessions.length} class${sessions.length === 1 ? '' : 'es'} · ${totals.attended}/${totals.booked} checked in` : 'Loading…'}</p>
        </div>
        <div className="row gap">
          <div className="seg">
            <button className="icon-btn" onClick={() => setDay(addDaysTz(day, -1, tz))} aria-label="Previous day"><Icon name="chevL" /></button>
            <button className="btn sm ghost" onClick={() => setDay(startOfDayTz(new Date(), tz))} disabled={isToday}>Today</button>
            <button className="icon-btn" onClick={() => setDay(addDaysTz(day, 1, tz))} aria-label="Next day"><Icon name="chevR" /></button>
          </div>
          <button className="btn primary" onClick={() => setBookFor({ blank: true })}><Icon name="plus" /> Book a member</button>
        </div>
      </div>

      {!sessions ? <Spinner full={false} /> : sessions.length === 0 ? (
        <Empty title="No bookings for this day">Classes show up here as soon as members book them on your class calendars.</Empty>
      ) : (
        <div className="sessions">
          {sessions.map((s) => {
            const pct = s.capacity ? Math.min(100, Math.round((s.booked / s.capacity) * 100)) : 0;
            return (
              <section className="card session" key={`${s.calendarId}${s.startTime}`}>
                <div className="session-head">
                  <div>
                    <div className="session-time">{fmtTime(s.startTime, tz)}</div>
                    <h3>{s.name}</h3>
                  </div>
                  <div className="session-meta">
                    <div className="cap"><span>{s.booked}{s.capacity ? ` / ${s.capacity}` : ''}</span> booked{s.full && <Badge tone="warn">Full</Badge>}</div>
                    {s.capacity && <div className="bar"><div style={{ width: `${pct}%` }} /></div>}
                    <button className="btn sm" onClick={() => setBookFor({ calendarId: s.calendarId, startTime: s.startTime, name: s.name, full: s.full })}><Icon name="plus" size={14} /> Add</button>
                  </div>
                </div>

                <ul className="roster">
                  {s.roster.map((r) => (
                    <li key={r.bookingId} className={r.status}>
                      <button className="who" onClick={() => onOpenMember(r.contactId)}>
                        <Avatar name={r.name} size={30} />
                        <span><strong>{r.name}</strong><small>{r.unlimited ? 'Unlimited' : r.owesCredit ? 'No credit — collect payment' : `${r.balance ?? 0} credits left`}</small></span>
                      </button>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      <div className="roster-actions">
                        {r.status !== 'attended' && (
                          <button className="btn sm good" disabled={busy === r.bookingId} onClick={() => act(r.bookingId, () => api.checkIn(r.bookingId), `${r.name.split(' ')[0]} checked in`)}>
                            <Icon name="check" size={14} /> Check in
                          </button>
                        )}
                        {r.status === 'booked' && (
                          <>
                            <button className="btn sm ghost" disabled={busy === r.bookingId} onClick={() => act(r.bookingId, () => api.noShow(r.bookingId), 'Marked no-show')}>No-show</button>
                            <button className="icon-btn" title="Cancel booking" onClick={() => setCancelFor({ ...r, session: s })}><Icon name="x" /></button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {s.waitlist.length > 0 && (
                  <div className="waitlist">
                    <h4><Icon name="list" size={14} /> Waitlist ({s.waitlist.length})</h4>
                    <ol>
                      {s.waitlist.map((w) => (
                        <li key={w.id}>
                          <button className="link" onClick={() => onOpenMember(w.contactId)}>{w.name}</button>
                          <button className="icon-btn" title="Remove from waitlist" onClick={() => act(w.id, () => api.removeFromWaitlist(w.id), 'Removed from waitlist')}><Icon name="x" size={14} /></button>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {cancelFor && <CancelModal booking={cancelFor} tz={tz} onClose={() => setCancelFor(null)}
        onConfirm={(refund) => act(cancelFor.bookingId, () => api.cancelBooking(cancelFor.bookingId, refund), refund ? 'Cancelled, credit returned' : 'Booking cancelled').then(() => setCancelFor(null))} />}
      {bookFor && <BookModal target={bookFor} day={day} tz={tz} notify={notify} onClose={() => setBookFor(null)} onDone={() => { setBookFor(null); load(); }} />}
    </div>
  );
}

function CancelModal({ booking, tz, onClose, onConfirm }) {
  const [refund, setRefund] = useState(true);
  return (
    <Modal title="Cancel booking" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Keep booking</button><button className="btn danger" onClick={() => onConfirm(refund)}>Cancel booking</button></>}>
      <p>Cancel <strong>{booking.name}</strong> from {booking.session.name} at {fmtTime(booking.session.startTime, tz)}?</p>
      {!booking.unlimited && (
        <label className="check">
          <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
          <span>Return the credit to the member <small className="muted">(overrides the late-cancel rule)</small></span>
        </label>
      )}
      <p className="muted small">The next person on the waitlist with credits gets the seat automatically.</p>
    </Modal>
  );
}

function BookModal({ target, day, tz, notify, onClose, onDone }) {
  const [member, setMember] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [calendarId, setCalendarId] = useState(target.calendarId || '');
  const [time, setTime] = useState(() => {
    const d = target.startTime ? new Date(target.startTime) : new Date(day.getTime() + 18 * 3600e3);
    return toZonedInput(d, tz);
  });
  const [saving, setSaving] = useState(false);
  const [full, setFull] = useState(!!target.full);

  useEffect(() => {
    if (!target.blank) return;
    api.settings().then((r) => {
      const cals = r.settings.calendars.filter((c) => c.usesCredits);
      setCalendars(cals);
      if (!calendarId && cals[0]) setCalendarId(cals[0].calendarId);
    }).catch(() => {});
  }, [target.blank]); // eslint-disable-line react-hooks/exhaustive-deps

  // While someone is typing a date the input can hold a partial/empty value: never let that throw.
  const picked = time ? fromZonedInput(time, tz) : null;
  const validTime = !!target.startTime || (picked && !Number.isNaN(picked.getTime()));
  const startTime = target.startTime || (validTime ? picked.toISOString() : null);

  const submit = async (waitlist = false) => {
    if (!member) return notify('Pick a member first', true);
    if (!startTime) return notify('Pick a valid start time', true);
    setSaving(true);
    try {
      if (waitlist) {
        const r = await api.addToWaitlist({ calendarId, startTime, contactId: member.contactId });
        notify(`${member.name} is #${r.position} on the waitlist`);
        return onDone();
      }
      const r = await api.staffBook({ calendarId, startTime, contactId: member.contactId });
      if (r.rejected) notify(`${member.name} has no credits — booking cancelled and a buy link was texted`, true);
      else if (r.owesCredit) notify(`Booked ${member.name} — no credit, collect payment`);
      else notify(`Booked ${member.name}`);
      onDone();
    } catch (e) {
      if (e.code === 'FULL') setFull(true);
      notify(e.message, true);
    } finally { setSaving(false); }
  };

  return (
    <Modal title={target.name ? `Add to ${target.name} · ${fmtTime(target.startTime, tz)}` : 'Book a member'} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Close</button>
        {full ? <button className="btn primary" disabled={saving} onClick={() => submit(true)}>Add to waitlist</button>
          : <button className="btn primary" disabled={saving || !calendarId || !validTime} onClick={() => submit(false)}>{saving ? 'Booking…' : 'Book'}</button>}
      </>}>
      <MemberPicker value={member} onChange={setMember} notify={notify} />
      {target.blank && (
        <div className="grid2">
          <Field label="Class">
            <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => <option key={c.calendarId} value={c.calendarId}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Start time" hint={tz ? `Studio time (${tz.replace(/_/g, ' ')})` : undefined}><input type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
      )}
      {member && <p className="muted small">{member.name}: {isUnlimited(member) ? 'Unlimited membership' : `${member.balance} credits`}</p>}
      {full && <p className="warn-text small">This class is full — they'll get the next seat that opens.</p>}
    </Modal>
  );
}
