import React, { useEffect, useMemo, useState } from 'react';
import { setCurrency, currencySymbol, COMMON_CURRENCIES } from '../lib/format.js';
import { api } from '../lib/api.js';
import { CalendarsEditor, PolicyEditor } from '../components/Editors.jsx';
import { Field, Icon, Modal, Spinner } from '../components/ui.jsx';
import BrandEditor from '../components/BrandEditor.jsx';

const TEMPLATE_GROUPS = [
  ['Purchases & credits', [
    ['purchased', 'Package purchased'],
    ['lowCredits', 'Credits running low'],
    ['expiring', 'Credits expiring soon']
  ]],
  ['Bookings', [
    ['booked', 'Class booked'],
    ['noCredits', 'Booking blocked, no credits'],
    ['refunded', 'Cancelled in time (credit back)'],
    ['lateCancel', 'Late cancel (credit kept)'],
    ['checkedIn', 'Checked in']
  ]],
  ['Waitlist', [
    ['waitlistJoined', 'Joined the waitlist'],
    ['waitlistPromoted', 'Got a seat from the waitlist']
  ]]
];
const VARS = ['first_name', 'credits', 'class_name', 'class_time', 'package_name', 'expiry_date', 'buy_link', 'position', 'studio_name'];

const TRIGGERS = [
  ['Class pack purchased', 'Welcome series, first-class tips'],
  ['Credits running low', 'Renewal offer'],
  ['Class pack expiring soon', 'Use-it-or-lose-it nudge'],
  ['Member checked in', 'Milestones, review requests'],
  ['Member no-show', 'We-missed-you text, no-show fee'],
  ['Late cancellation', 'Policy reminder'],
  ['Booking blocked - no credits', 'Pack offer, front-desk alert'],
  ['Waitlist spot filled', 'Confirmation, directions']
];
const ACTIONS = [
  ['Add class credits', 'Referral rewards, comps, promos'],
  ['Remove class credits', 'No-show fees, corrections'],
  ['Give a ClassKit package', 'Trials, offline payments']
];

const SECTIONS = [
  ['share', 'Links', 'link'],
  ['website', 'Website', 'globe'],
  ['calendars', 'Class calendars', 'calendar'],
  ['rules', 'Booking rules', 'sliders'],
  ['branding', 'Branding', 'palette'],
  ['region', 'Region', 'clock'],
  ['texts', 'Member texts', 'message'],
  ['workflows', 'Workflows', 'zap']
];

function Section({ id, icon, title, desc, children, aside }) {
  return (
    <section className="card set-section" id={`set-${id}`}>
      <header className="set-head">
        <span className="set-icon"><Icon name={icon} size={17} /></span>
        <div className="grow"><h3>{title}</h3>{desc && <p className="muted small">{desc}</p>}</div>
        {aside}
      </header>
      <div className="set-body">{children}</div>
    </section>
  );
}

function copy(text, notify, what = 'Link copied') {
  navigator.clipboard?.writeText(text);
  notify(what);
}

function LinkTile({ icon, title, desc, url, notify, extra }) {
  return (
    <div className="link-tile">
      <div className="link-tile-top">
        <span className="link-tile-icon"><Icon name={icon} size={18} /></span>
        <div><strong>{title}</strong><p className="muted small">{desc}</p></div>
      </div>
      <div className="link-url" title={url}>{url.replace(/^https?:\/\//, '')}</div>
      <div className="row gap wrap">
        <button className="btn sm primary" onClick={() => copy(url, notify)}><Icon name="copy" size={14} /> Copy link</button>
        <a className="btn sm" href={url} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Open</a>
        {extra}
      </div>
    </div>
  );
}

function EmbedCodes({ scheduleUrl, color, notify }) {
  const [kind, setKind] = useState('widget');
  const origin = (() => { try { return new URL(scheduleUrl).origin; } catch { return window.location.origin; } })();
  const brand = /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#5B4BDB';
  const codes = {
    widget: `<script src="${origin}/widget.js" data-schedule="${scheduleUrl}" data-label="Book a class" data-color="${brand}" async></script>`,
    inline: `<iframe src="${scheduleUrl}?embed=1" title="Class schedule" style="width:100%;max-width:760px;height:720px;border:0;border-radius:16px" loading="lazy"></iframe>`
  };
  const opts = [
    ['widget', 'Floating button', 'A “Book a class” button in the corner of every page. Opens your schedule in a pop-up.'],
    ['inline', 'Inline embed', 'The schedule inside a page section, for example a “Classes” page.']
  ];
  return (
    <div className="embed-box">
      <div className="embed-choice" role="tablist">
        {opts.map(([k, label, hint]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            <strong>{label}</strong><span>{hint}</span>
          </button>
        ))}
      </div>
      <pre>{codes[kind]}</pre>
      <div className="row gap wrap">
        <button className="btn sm primary" onClick={() => copy(codes[kind], notify, 'Code copied')}><Icon name="copy" size={14} /> Copy code</button>
        {kind === 'widget' && <a className="btn sm" href={`${origin}/widget-preview.html?schedule=${encodeURIComponent(scheduleUrl)}&color=${encodeURIComponent(brand)}`} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Preview</a>}
        <span className="muted small">Paste into a Custom JS/HTML element on your site or funnel.</span>
      </div>
    </div>
  );
}

const snapshot = (x, cals) => JSON.stringify([x?.policy, x?.templates, x?.buyUrl, x?.brand, x?.timezone, x?.currency,
  (cals || []).map((c) => [c.calendarId, !!c.enabled, c.capacity, c.creditCost, c.durationMins])]);

export default function Settings({ notify, onSaved }) {
  const [s, setS] = useState(null);
  const [calendars, setCalendars] = useState(null);
  const [base, setBase] = useState(null); // last saved state, for "unsaved changes"
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [active, setActive] = useState('share');

  useEffect(() => {
    Promise.all([api.settings(), api.calendars().catch(() => ({ calendars: [] }))])
      .then(([r, c]) => { setS(r.settings); setCalendars(c.calendars); setBase(snapshot(r.settings, c.calendars)); })
      .catch((e) => notify(e.message, true));
  }, [notify]);

  useEffect(() => {
    if (!s) return undefined;
    const els = SECTIONS.map(([id]) => document.getElementById(`set-${id}`)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id.replace('set-', ''));
    }, { rootMargin: '-100px 0px -55% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [!!s]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => !!s && base !== null && snapshot(s, calendars) !== base, [s, calendars, base]);

  if (!s || !calendars) return <Spinner full={false} />;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.saveSettings({ calendars, policy: s.policy, templates: s.templates, buyUrl: s.buyUrl, brand: s.brand, timezone: s.timezone, currency: s.currency });
      setS(r.settings); setBase(snapshot(r.settings, calendars));
      setCurrency(r.settings.currency);
      onSaved?.(r.settings);
      notify('Settings saved');
    } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };
  const rotate = async () => {
    try {
      const r = await api.rotateKiosk();
      setS({ ...s, ...r });
      notify('New kiosk link created. The old one no longer works.');
    } catch (e) { notify(e.message, true); } finally { setConfirmReset(false); }
  };
  const go = (id) => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="page settings">
      <div className="page-head sticky">
        <div>
          <h1>Settings</h1>
          <p className={`small ${dirty ? 'warn-text' : 'muted'}`}>{dirty ? '● Unsaved changes' : 'All changes saved'}</p>
        </div>
        <button className="btn primary" disabled={saving || !dirty} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, label, icon]) => (
            <button key={id} className={active === id ? 'on' : ''} onClick={() => go(id)}><Icon name={icon} size={15} /> {label}</button>
          ))}
        </nav>

        <div className="settings-body">
          <Section id="share" icon="link" title="Links" desc="Share with members, or open at the front desk.">
            <div className="link-tiles">
              <LinkTile icon="tablet" title="Front-desk kiosk" desc="Open on a tablet at reception. Members check in with their mobile number."
                url={s.kioskUrl} notify={notify}
                extra={<button className="btn sm ghost" onClick={() => setConfirmReset(true)}><Icon name="refresh" size={14} /> Reset</button>} />
              <LinkTile icon="calendar" title="Class schedule" desc="Open seats and the waitlist. For your link-in-bio, WhatsApp or emails."
                url={s.scheduleUrl} notify={notify} />
            </div>
          </Section>

          <Section id="website" icon="globe" title="Add to your website" desc="Show your live schedule on your own site or funnel.">
            <EmbedCodes scheduleUrl={s.scheduleUrl} color={s.brand?.color} notify={notify} />
          </Section>

          <Section id="calendars" icon="calendar" title="Class calendars" desc="Pick the calendars where a booking takes credits.">
            <CalendarsEditor calendars={calendars} onChange={setCalendars} onRefresh={() => api.calendars().then((r) => setCalendars(r.calendars)).catch((e) => notify(e.message, true))} />
          </Section>

          <Section id="rules" icon="sliders" title="Booking rules" desc="Cancellations, reminders, no-shows and what happens when credits run out.">
            <Field label="Buy link" hint="Where members buy more classes. Sent when they run low or run out.">
              <input value={s.buyUrl} onChange={(e) => setS({ ...s, buyUrl: e.target.value })} placeholder="https://yourstudio.com/class-packs" />
            </Field>
            <PolicyEditor policy={s.policy} onChange={(p) => setS({ ...s, policy: p })} />
          </Section>

          <Section id="branding" icon="palette" title="Branding" desc="Your logo, name and colour in ClassKit, the kiosk, schedule and widget.">
            <BrandEditor brand={s.brand} locationName={s.locationName} notify={notify} onChange={(brand) => setS({ ...s, brand })} />
          </Section>

          <Section id="region" icon="clock" title="Region" desc="Time zone and currency for class times, prices and reports.">
            <div className="grid2">
              <Field label="Time zone" hint="Class times and days are shown in this zone.">
                <input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} placeholder="America/New_York" />
              </Field>
              <Field label="Currency" hint={s.currencyLocked ? 'Used for prices and reports.' : 'Picked up from your account. Change it if it looks wrong.'}>
                <select value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })}>
                  {[...new Set([s.currency, ...COMMON_CURRENCIES])].map((c) => <option key={c} value={c}>{c} ({currencySymbol(c)})</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section id="texts" icon="message" title="Member texts" desc="SMS sent from your HighLevel number. Leave a message empty to skip it."
            aside={<span className={`badge ${s.policy.smsEnabled ? 'good' : 'muted'}`}>{s.policy.smsEnabled ? 'SMS on' : 'SMS off'}</span>}>
            <div className="var-chips">
              <span className="small muted">Insert with:</span>
              {VARS.map((v) => <button key={v} type="button" className="var-chip" onClick={() => copy(`{{${v}}}`, notify, `{{${v}}} copied`)}>{`{{${v}}}`}</button>)}
            </div>
            {TEMPLATE_GROUPS.map(([group, items]) => (
              <div key={group} className="tpl-group">
                <h4>{group}</h4>
                {items.map(([k, label]) => (
                  <div key={k} className="tpl-row">
                    <span className="tpl-label">{label}</span>
                    <textarea rows={2} value={s.templates[k] ?? ''} placeholder="No text sent" onChange={(e) => setS({ ...s, templates: { ...s.templates, [k]: e.target.value } })} />
                  </div>
                ))}
              </div>
            ))}
          </Section>

          <Section id="workflows" icon="zap" title="Workflows" desc="In Automation › Workflows, search “ClassKit” to use these.">
            <div className="wf-grid">
              <div>
                <h4>Triggers</h4>
                <ul className="wf-list">{TRIGGERS.map(([t, g]) => <li key={t}><strong>{t}</strong><span>{g}</span></li>)}</ul>
              </div>
              <div>
                <h4>Actions</h4>
                <ul className="wf-list">{ACTIONS.map(([a, g]) => <li key={a}><strong>{a}</strong><span>{g}</span></li>)}</ul>
                <h4 className="mt">Contact field & tags</h4>
                <p className="small muted">Every member gets the <b>ClassKit Credits</b> field and the tags <code>classkit-active</code>, <code>classkit-low-credits</code>, <code>classkit-no-credits</code> and <code>classkit-unlimited</code> for smart lists and filters.</p>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {confirmReset && (
        <Modal title="Reset the kiosk link?" onClose={() => setConfirmReset(false)}
          footer={<><button className="btn ghost" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn danger" onClick={rotate}>Reset link</button></>}>
          <p className="muted">The current kiosk link stops working right away. Open the new link on your front-desk tablet afterwards.</p>
        </Modal>
      )}
    </div>
  );
}
