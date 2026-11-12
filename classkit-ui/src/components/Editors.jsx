import React from 'react';
import { Field, Toggle } from './ui.jsx';

/** Pick which GHL calendars run on credits, with seats and credit cost per class. */
export function CalendarsEditor({ calendars, onChange }) {
  const update = (i, patch) => onChange(calendars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  if (!calendars.length) return <p className="warn-text small">No calendars found. Create a Class Booking calendar in HighLevel first.</p>;
  return (
    <table className="table cal-table">
      <thead><tr><th>Uses credits</th><th>Calendar</th><th className="num">Seats</th><th className="num">Credits per class</th><th className="num">Minutes</th></tr></thead>
      <tbody>
        {calendars.map((c, i) => (
          <tr key={c.calendarId} className={c.enabled ? '' : 'dim'}>
            <td><Toggle checked={c.enabled} onChange={(v) => update(i, { enabled: v })} /></td>
            <td><strong>{c.name}</strong>{c.calendarType && <small className="muted block">{String(c.calendarType).replace(/_/g, ' ')}</small>}</td>
            <td className="num"><input className="num-input" type="number" min="1" value={c.capacity} disabled={!c.enabled} onChange={(e) => update(i, { capacity: Number(e.target.value) })} /></td>
            <td className="num"><input className="num-input" type="number" min="0" value={c.creditCost} disabled={!c.enabled} onChange={(e) => update(i, { creditCost: Number(e.target.value) })} /></td>
            <td className="num"><input className="num-input" type="number" min="5" step="5" value={c.durationMins} disabled={!c.enabled} onChange={(e) => update(i, { durationMins: Number(e.target.value) })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Studio booking rules. */
export function PolicyEditor({ policy, onChange }) {
  const set = (k, v) => onChange({ ...policy, [k]: v });
  const num = (k) => (e) => set(k, Number(e.target.value));
  return (
    <div className="stack">
      <div className="grid2">
        <Field label="Free cancellation window (hours)" hint="Cancel earlier than this → credit back. Later → the studio keeps it.">
          <input type="number" min="0" value={policy.cancelWindowHours} onChange={num('cancelWindowHours')} />
        </Field>
        <Field label="Low-credit alert at" hint="Text the member (and fire the workflow trigger) when they drop to this many.">
          <input type="number" min="0" value={policy.lowCreditThreshold} onChange={num('lowCreditThreshold')} />
        </Field>
        <Field label="Expiry reminder (days before)" hint="0 turns the reminder off."><input type="number" min="0" value={policy.expiryReminderDays} onChange={num('expiryReminderDays')} /></Field>
        <Field label="Auto no-show (minutes after class)" hint="Not checked in by then → marked no-show. 0 turns it off."><input type="number" min="0" value={policy.autoNoShowMinutes} onChange={num('autoNoShowMinutes')} /></Field>
        <Field label="Manual credits valid for (days)"><input type="number" min="1" value={policy.defaultValidityDays} onChange={num('defaultValidityDays')} /></Field>
        <Field label="Kiosk check-in opens (minutes before class)"><input type="number" min="0" value={policy.checkInOpensMins} onChange={num('checkInOpensMins')} /></Field>
      </div>
      <Toggle checked={policy.blockWithoutCredits} onChange={(v) => set('blockWithoutCredits', v)} label="Cancel bookings from members with no credits and text them a buy link" />
      <Toggle checked={policy.waitlistEnabled} onChange={(v) => set('waitlistEnabled', v)} label="Waitlist: fill freed seats automatically, first come first served" />
      <Toggle checked={policy.smsEnabled} onChange={(v) => set('smsEnabled', v)} label="Send members SMS updates (bookings, credits, waitlist)" />
    </div>
  );
}
