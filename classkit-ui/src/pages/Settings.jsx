import React, { useEffect, useState } from 'react';
import { setCurrency, currencySymbol, COMMON_CURRENCIES } from '../lib/format.js';
import { api } from '../lib/api.js';
import { CalendarsEditor, PolicyEditor } from '../components/Editors.jsx';
import { CopyLink, Field, Icon, Spinner } from '../components/ui.jsx';
import BrandEditor from '../components/BrandEditor.jsx';

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

function EmbedCodes({ scheduleUrl, color, notify }) {
  const [kind, setKind] = useState('widget');
  const origin = (() => { try { return new URL(scheduleUrl).origin; } catch { return window.location.origin; } })();
  const brand = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#5B4BDB';
  const codes = {
    widget: `<script src="${origin}/widget.js" data-schedule="${scheduleUrl}" data-label="Book a class" data-color="${brand}" async></script>`,
    inline: `<iframe src="${scheduleUrl}?embed=1" title="Class schedule" style="width:100%;max-width:760px;height:720px;border:0;border-radius:16px" loading="lazy"></iframe>`,
    link: scheduleUrl
  };
  const hints = {
    widget: 'A floating “Book a class” button in the corner of every page. Opens your schedule in a pop-up, full screen on phones.',
    inline: 'Shows the schedule inside a page section, e.g. a “Classes” page.',
    link: 'A plain link for buttons, Instagram bio, WhatsApp or emails.'
  };
  return (
    <div className="embed-box">
      <div className="embed-tabs" role="tablist">
        {[['widget', 'Floating button'], ['inline', 'Inline embed'], ['link', 'Link']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <p className="small muted">{hints[kind]}</p>
      <pre>{codes[kind]}</pre>
      <div className="row gap">
        <button className="btn sm primary" onClick={() => { navigator.clipboard?.writeText(codes[kind]); notify('Code copied'); }}><Icon name="copy" size={14} /> Copy code</button>
        {kind === 'widget' && <a className="btn sm ghost" href={`${origin}/widget-preview.html?schedule=${encodeURIComponent(scheduleUrl)}&color=${encodeURIComponent(brand)}`} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Preview</a>}
      </div>
    </div>
  );
}

export default function Settings({ notify, onSaved }) {
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
      const r = await api.saveSettings({ calendars, policy: s.policy, templates: s.templates, buyUrl: s.buyUrl, brand: s.brand, timezone: s.timezone, currency: s.currency });
      setS(r.settings);
      setCurrency(r.settings.currency);
      onSaved?.(r.settings);
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
        <h3>Add to your website</h3>
        <p className="muted small">Paste one of these into your website, funnel or HighLevel site (Custom JS/HTML element). Members see your live schedule, open seats and the waitlist.</p>
        <EmbedCodes scheduleUrl={s.scheduleUrl} color={s.brand?.color} notify={notify} />
      </section>

      <section className="card">
        <h3>Class calendars</h3>
        <CalendarsEditor calendars={calendars} onChange={setCalendars} onRefresh={() => api.calendars().then((r) => setCalendars(r.calendars)).catch((e) => notify(e.message, true))} />
      </section>

      <section className="card">
        <h3>Booking rules</h3>
        <PolicyEditor policy={s.policy} onChange={(p) => setS({ ...s, policy: p })} />
      </section>

      <section className="card">
        <h3>Branding</h3>
        <BrandEditor brand={s.brand} locationName={s.locationName} notify={notify} onChange={(brand) => setS({ ...s, brand })} />
      </section>

      <section className="card">
        <h3>Region</h3>
        <div className="grid2">
          <Field label="Time zone" hint="Class times are shown in this zone."><input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} placeholder="America/New_York" /></Field>
        <Field label="Currency" hint={s.currencyLocked ? 'Used for prices and reports.' : 'Picked up from your HighLevel account. Change it if it looks wrong.'}>
          <select value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} >
            {[...new Set([s.currency, ...COMMON_CURRENCIES])].map((c) => <option key={c} value={c}>{c} ({currencySymbol(c)})</option>)}
          </select>
        </Field>
        </div>
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
