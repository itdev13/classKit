import React from 'react';
import { Field, Toggle, NumberInput } from './ui.jsx';

const TYPE_LABEL = {
  class_booking: 'Group class',
  service_booking: 'Service booking',
  event: 'Event',
  round_robin: 'Team / round robin',
  collective: 'Collective',
  personal: 'One-on-one'
};
export const isClassType = (t) => /class/i.test(t || '');

function Stepper({ label, unit, value, onChange, min = 0, step = 1 }) {
  const set = (v) => onChange(Number.isFinite(v) ? Math.max(min, v) : min);
  return (
    <div className="rule">
      <span className="rule-label">{label}</span>
      <div className="rule-ctl">
        <button type="button" aria-label={`Less ${label}`} onClick={() => set(Number(value) - step)} disabled={Number(value) <= min}>−</button>
        <NumberInput min={min} step={step} value={value} onChange={set} aria-label={label} />
        <button type="button" aria-label={`More ${label}`} onClick={() => set(Number(value) + step)}>+</button>
        <span className="rule-unit">{unit}</span>
      </div>
    </div>
  );
}

/** Pick which GHL calendars run on credits, with seats and credit cost per class. */
export function CalendarsEditor({ calendars, onChange, onRefresh }) {
  const update = (i, patch) => onChange(calendars.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const on = calendars.filter((c) => c.enabled).length;
  const hasClassType = calendars.some((c) => isClassType(c.calendarType));

  const help = (
    <div className="cal-help">
      <strong>Don't see your classes?</strong>
      <span>In HighLevel go to <b>Calendars → New calendar → Class Booking</b>, create one (for example "Yoga, Mon 7am"), then come back here.</span>
      {onRefresh && <button type="button" className="btn sm" onClick={onRefresh}>Refresh list</button>}
    </div>
  );

  if (!calendars.length) return <div className="stack"><p className="warn-text">This sub-account has no calendars yet.</p>{help}</div>;

  return (
    <div className="stack">
      <div className="cal-list">
        {calendars.map((c, i) => {
          const suggested = isClassType(c.calendarType);
          return (
            <div key={c.calendarId} className={`cal-card${c.enabled ? ' on' : ''}`}>
              <label className="cal-top">
                <input type="checkbox" checked={!!c.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                <span className="cal-name">
                  <strong>{c.name}</strong>
                  <small>{TYPE_LABEL[c.calendarType] || String(c.calendarType || 'Calendar').replace(/_/g, ' ')}</small>
                </span>
                {suggested && !c.enabled && <span className="badge accent">Looks like a class</span>}
                <span className={`cal-state ${c.enabled ? 'yes' : ''}`}>{c.enabled ? 'Uses credits' : 'Free – not tracked'}</span>
              </label>
              {c.enabled && (
                <div className="cal-rules">
                  <Stepper label="Seats per class" unit="people" min={1} value={c.capacity} onChange={(v) => update(i, { capacity: v })} />
                  <Stepper label="Cost per booking" unit={c.creditCost === 1 ? 'credit' : 'credits'} min={0} value={c.creditCost} onChange={(v) => update(i, { creditCost: v })} />
                  <Stepper label="Class length" unit="min" min={5} step={5} value={c.durationMins} onChange={(v) => update(i, { durationMins: v })} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="small muted">{on ? `${on} calendar${on > 1 ? 's' : ''} will use credits. Bookings on all others stay free and untouched.` : 'Tick the calendars where people book a class. Leave 1-on-1 services, consultations and calls unticked.'}</p>
      {!hasClassType && help}
    </div>
  );
}

/** Studio booking rules. */
export function PolicyEditor({ policy, onChange }) {
  const set = (k, v) => onChange({ ...policy, [k]: v });
  const num = (k) => (v) => set(k, v);
  return (
    <div className="stack">
      <div className="grid2">
        <Field label="Free cancellation window (hours)" hint="Cancel earlier than this → credit back. Later → the studio keeps it.">
          <NumberInput min="0" value={policy.cancelWindowHours} onChange={num('cancelWindowHours')} />
        </Field>
        <Field label="Low-credit alert at" hint="Text the member (and fire the workflow trigger) when they drop to this many.">
          <NumberInput min="0" value={policy.lowCreditThreshold} onChange={num('lowCreditThreshold')} />
        </Field>
        <Field label="Expiry reminder (days before)" hint="0 turns the reminder off."><NumberInput min="0" value={policy.expiryReminderDays} onChange={num('expiryReminderDays')} /></Field>
        <Field label="Auto no-show (minutes after class)" hint="Not checked in by then → marked no-show. 0 turns it off."><NumberInput min="0" value={policy.autoNoShowMinutes} onChange={num('autoNoShowMinutes')} /></Field>
        <Field label="Manual credits valid for (days)"><NumberInput min="1" value={policy.defaultValidityDays} onChange={num('defaultValidityDays')} /></Field>
        <Field label="Kiosk check-in opens (minutes before class)"><NumberInput min="0" value={policy.checkInOpensMins} onChange={num('checkInOpensMins')} /></Field>
      </div>
      <Toggle checked={policy.blockWithoutCredits} onChange={(v) => set('blockWithoutCredits', v)} label="Cancel bookings from members with no credits and text them a buy link" />
      <Toggle checked={policy.waitlistEnabled} onChange={(v) => set('waitlistEnabled', v)} label="Waitlist: fill freed seats automatically, first come first served" />
      <Toggle checked={policy.smsEnabled} onChange={(v) => set('smsEnabled', v)} label="Send members SMS updates (bookings, credits, waitlist)" />
    </div>
  );
}
