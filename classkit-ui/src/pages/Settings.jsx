import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { CalendarsEditor, PolicyEditor } from '../components/Editors.jsx';
import { CopyLink, Field, Spinner } from '../components/ui.jsx';

const TEMPLATE_LABELS = {
  purchased: 'Package purchased',
  booked: 'Class booked',
  noCredits: 'Booking blocked — no credits',
  refunded: 'Cancelled in time (credit back)',
  lateCancel: 'Late cancel (credit kept)',
  waitlistJoined: 'Joined waitlist',
  waitlistPromoted: 'Got a seat from the waitlist',
  lowCredits: 'Low credits',
  expiring: 'Credits expiring soon',
  checkedIn: 'Checked in (leave empty to skip)'
};
const VARS = '{{first_name}} {{credits}} {{class_name}} {{class_time}} {{package_name}} {{expiry_date}} {{buy_link}} {{position}} {{studio_name}}';

const TRIGGERS = [
  ['ClassKit: package purchased', 'Welcome series, first-class tips'],
  ['ClassKit: credits low', 'Renewal offer'],
  ['ClassKit: package expiring', 'Use-it-or-lose-it nudge'],
  ['ClassKit: checked in', 'Milestones (10th class), review requests'],
  ['ClassKit: no-show', 'Check-in text, no-show fee'],
  ['ClassKit: late cancel', 'Policy reminder'],
  ['ClassKit: booking blocked', 'Follow up with a pack offer'],
  ['ClassKit: waitlist promoted', 'Confirmation, directions']
];

export default function Settings({ notify }) {
  const [s, setS] = useState(null);
  const [calendars, setCalendars] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then((r) => setS(r.settings)).catch((e) => notify(e.message, true));
    api.calendars().then((r) => setCalendars(r.calendars)).catch(() => setCalendars([]));
  }, [notify]);
  if (!s || !calendars) return <Spinner full={false} />;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveSettings({ calendars, policy: s.policy, templates: s.templates, buyUrl: s.buyUrl, brand: s.brand, timezone: s.timezone });
      setS(r.settings);
      notify('Settings saved');
    } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };
  const rotate = async () => {
    try { const r = await api.rotateKiosk(); setS({ ...s, ...r }); notify('New kiosk link created. The old one stops working.'); } catch (e) { notify(e.message, true); }
  };

  return (
    <div className="page settings">
      <div className="page-head sticky">
        <div><h1>Settings</h1></div>
        <button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      <section className="card">
        <h3>Links</h3>
        <Field label="Front-desk kiosk" hint="Open on a tablet at reception. Members check in with their mobile number.">
          <CopyLink url={s.kioskUrl} notify={notify} />
        </Field>
        <button className="btn sm ghost" onClick={rotate}>Create a new kiosk link</button>
        <Field label="Public class schedule" hint="Shows open seats and lets members join the waitlist for full classes. Add it to your site or link-in-bio.">
          <CopyLink url={s.scheduleUrl} notify={notify} />
        </Field>
        <Field label="Buy link" hint="Sent to members who run out of credits."><input value={s.buyUrl} onChange={(e) => setS({ ...s, buyUrl: e.target.value })} placeholder="https://yourstudio.com/class-packs" /></Field>
      </section>

      <section className="card">
        <h3>Class calendars</h3>
        <CalendarsEditor calendars={calendars} onChange={setCalendars} />
      </section>

      <section className="card">
        <h3>Booking rules</h3>
        <PolicyEditor policy={s.policy} onChange={(p) => setS({ ...s, policy: p })} />
      </section>

      <section className="card">
        <h3>Branding</h3>
        <div className="grid3">
          <Field label="Studio name"><input value={s.brand.name} onChange={(e) => setS({ ...s, brand: { ...s.brand, name: e.target.value } })} placeholder={s.locationName || 'Your studio'} /></Field>
          <Field label="Brand color"><input type="color" value={s.brand.color} onChange={(e) => setS({ ...s, brand: { ...s.brand, color: e.target.value } })} /></Field>
          <Field label="Time zone"><input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} placeholder="America/New_York" /></Field>
        </div>
        <Field label="Logo URL" hint="Shown on the kiosk and schedule."><input value={s.brand.logoUrl} onChange={(e) => setS({ ...s, brand: { ...s.brand, logoUrl: e.target.value } })} placeholder="https://…/logo.png" /></Field>
      </section>

      <section className="card">
        <h3>Member texts</h3>
        <p className="muted small">Sent from your HighLevel number. Leave a message empty to skip it. Variables: <code>{VARS}</code></p>
        <div className="stack">
          {Object.entries(TEMPLATE_LABELS).map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea rows={2} value={s.templates[k] ?? ''} onChange={(e) => setS({ ...s, templates: { ...s.templates, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Use ClassKit in workflows</h3>
        <p className="muted small">In Automation → Workflows, search “ClassKit” to find these triggers. The actions “Add class credits”, “Remove class credits” and “Give package” are there too.</p>
        <table className="table">
          <thead><tr><th>Trigger</th><th>Good for</th></tr></thead>
          <tbody>{TRIGGERS.map(([t, g]) => <tr key={t}><td>{t}</td><td className="muted">{g}</td></tr>)}</tbody>
        </table>
        <p className="muted small">Every contact also gets the “ClassKit Credits” field and the tags <code>classkit-active</code>, <code>classkit-low-credits</code>, <code>classkit-no-credits</code> and <code>classkit-unlimited</code>, for smart lists and workflow filters.</p>
      </section>
    </div>
  );
}
