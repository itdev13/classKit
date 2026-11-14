import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, getCurrency } from '../lib/format.js';
import { CalendarsEditor, PolicyEditor, isClassType } from '../components/Editors.jsx';
import { Field, Icon, Spinner, NumberInput } from '../components/ui.jsx';

const STEPS = [
  { title: 'Class calendars', icon: 'calendar', heading: 'Which calendars are your classes?', desc: 'Pick the calendars where members book a class. Every booking there takes credits from the member’s pack.' },
  { title: 'Booking rules', icon: 'sliders', heading: 'Your booking rules', desc: 'How cancellations, reminders and no-shows work. Sensible defaults are already filled in.' },
  { title: 'First package', icon: 'ticket', heading: 'What do you sell?', desc: 'Create your first package. Link it to a HighLevel product so paying for it adds credits automatically.' },
  { title: 'Go live', icon: 'check', heading: 'You’re ready to go live', desc: 'Here’s what ClassKit will do from now on. You can change everything later in Settings.' }
];

const KINDS = [
  { id: 'pack', label: 'Class pack', hint: 'e.g. 10 classes, use within 90 days', defaults: { name: '10-Class Pack', credits: 10, validityDays: 90, priceUsd: 150 } },
  { id: 'unlimited', label: 'Unlimited', hint: 'Any class for a period, e.g. monthly', defaults: { name: 'Unlimited Monthly', credits: 0, validityDays: 31, priceUsd: 129 } },
  { id: 'dropin', label: 'Drop-in', hint: 'A single class', defaults: { name: 'Drop-in', credits: 1, validityDays: 30, priceUsd: 22 } }
];

export default function SetupWizard({ isAdmin, notify, onDone }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(null);
  const [calendars, setCalendars] = useState(null);
  const [pkg, setPkg] = useState({ kind: 'pack', ...KINDS[0].defaults, ghlProductIds: [] });
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const loadCalendars = () => api.calendars()
    .then((r) => setCalendars(r.calendars.map((c) => ({ ...c, enabled: c.enabled || isClassType(c.calendarType) }))))
    .catch((e) => { notify(e.message, true); setCalendars([]); });

  useEffect(() => {
    api.settings().then((r) => setSettings(r.settings)).catch((e) => notify(e.message, true));
    loadCalendars();
    api.products().then((r) => setProducts(r.products)).catch(() => {});
  }, [notify]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <span className="set-icon"><Icon name="gear" /></span>
          <h2>ClassKit isn’t set up yet</h2>
          <p className="muted">Ask a sub-account admin to open ClassKit and finish the 3-minute setup.</p>
        </div>
      </div>
    );
  }
  if (!settings || !calendars) return <Spinner />;

  const enabled = calendars.filter((c) => c.enabled);
  const next = async (skip = false) => {
    setSaving(true);
    try {
      if (step === 0) {
        if (!enabled.length) throw new Error('Tick at least one class calendar');
        await api.saveSettings({ calendars });
      }
      if (step === 1) await api.saveSettings({ policy: settings.policy, buyUrl: settings.buyUrl });
      if (step === 2 && !skip && pkg.name) {
        const r = await api.createPackage(pkg);
        setCreated(r.package || pkg);
      }
      if (step === 3) {
        await api.completeSetup();
        return onDone();
      }
      setStep(step + 1);
    } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };
  const cur = STEPS[step];
  const pickKind = (k) => setPkg({ ...pkg, kind: k.id, ...k.defaults });
  const perClass = pkg.kind !== 'unlimited' && pkg.priceUsd && pkg.credits > 1 ? pkg.priceUsd / pkg.credits : null;

  return (
    <div className="wizard">
      <div className="wizard-head">
        <img src="/icon.svg" alt="" width="44" height="44" />
        <div><h1>Set up ClassKit</h1><p className="muted">About 3 minutes. You can change everything later in Settings.</p></div>
      </div>

      <ol className="wiz-steps" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <span className="dot">{i < step ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="lbl">{s.title}</span>
          </li>
        ))}
      </ol>

      <div className="card wizard-card">
        <header className="set-head">
          <span className="set-icon"><Icon name={cur.icon} size={18} /></span>
          <div><h2>{cur.heading}</h2><p className="muted">{cur.desc}</p></div>
        </header>

        <div className="wizard-body">
          {step === 0 && (
            <>
              <div className="explain">
                <div><span className="explain-n">1</span><b>Priya buys a 10-class pack</b><small>She now has 10 credits</small></div>
                <div><span className="explain-n">2</span><b>She books “Yoga, Mon 7am”</b><small>1 credit is taken, so 9 left</small></div>
                <div><span className="explain-n">3</span><b>Class is full?</b><small>She joins the waitlist</small></div>
              </div>
              <CalendarsEditor calendars={calendars} onChange={setCalendars} onRefresh={() => { setCalendars(null); loadCalendars(); }} />
            </>
          )}

          {step === 1 && (
            <>
              <Field label="Buy link" hint="Where members buy more classes (payment link or funnel). Sent when they run low or run out.">
                <input value={settings.buyUrl} onChange={(e) => setSettings({ ...settings, buyUrl: e.target.value })} placeholder="https://yourstudio.com/class-packs" />
              </Field>
              <PolicyEditor policy={settings.policy} onChange={(p) => setSettings({ ...settings, policy: p })} />
            </>
          )}

          {step === 2 && (
            <div className="pkg-setup">
              <div className="stack">
                <div className="kind-cards">
                  {KINDS.map((k) => (
                    <button key={k.id} type="button" className={pkg.kind === k.id ? 'on' : ''} onClick={() => pickKind(k)}>
                      <strong>{k.label}</strong><span>{k.hint}</span>
                    </button>
                  ))}
                </div>
                <Field label="Name"><input value={pkg.name} onChange={(e) => setPkg({ ...pkg, name: e.target.value })} /></Field>
                <div className="grid3">
                  {pkg.kind !== 'unlimited' && <Field label="Classes"><NumberInput min="1" value={pkg.credits} onChange={(v) => setPkg({ ...pkg, credits: v })} /></Field>}
                  <Field label="Valid for (days)"><NumberInput min="1" value={pkg.validityDays} onChange={(v) => setPkg({ ...pkg, validityDays: v })} /></Field>
                  <Field label={`Price (${getCurrency()})`}><NumberInput min="0" value={pkg.priceUsd} onChange={(v) => setPkg({ ...pkg, priceUsd: v })} /></Field>
                </div>
                <Field label="HighLevel product" hint={products.length ? 'Paying for this product adds the credits.' : 'No products yet. Create one in Payments › Products, or link it later.'}>
                  <select value={pkg.ghlProductIds[0] || ''} onChange={(e) => setPkg({ ...pkg, ghlProductIds: e.target.value ? [e.target.value] : [] })}>
                    <option value="">Not linked yet</option>
                    {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="pkg-preview">
                <span className="small muted">Preview</span>
                <div className={`card pkg kind-${pkg.kind}`}>
                  <div className="pkg-top"><span className="badge">{KINDS.find((k) => k.id === pkg.kind).label}</span></div>
                  <h3>{pkg.name || 'Untitled package'}</h3>
                  <div className="pkg-big">{pkg.kind === 'unlimited' ? <><Icon name="infinity" size={24} /> Unlimited</> : <>{pkg.credits || 0}<small> class{pkg.credits === 1 ? '' : 'es'}</small></>}</div>
                  <div className="pkg-price"><b>{pkg.priceUsd ? money(pkg.priceUsd) : 'No price'}</b>{perClass ? <span>{money(perClass)} per class</span> : null}</div>
                  <div className="pkg-meta"><span><Icon name="clock" size={13} /> Valid {pkg.validityDays || 0} days</span></div>
                  <div className={`pkg-link ${pkg.ghlProductIds.length ? 'ok' : 'no'}`}>
                    <Icon name={pkg.ghlProductIds.length ? 'link' : 'alert'} size={13} />
                    {pkg.ghlProductIds.length ? 'Linked · sales add credits' : 'Not linked yet'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <>
              <div className="summary-grid">
                <div><span>Class calendars</span><b>{enabled.length}</b><small>{enabled.map((c) => c.name).join(', ')}</small></div>
                <div><span>Free cancellation</span><b>{settings.policy.cancelWindowHours} h</b><small>before class</small></div>
                <div><span>First package</span><b>{created ? created.name : 'Skipped'}</b><small>{created ? 'You can add more in Packages' : 'Create one in Packages'}</small></div>
              </div>
              <ul className="ticks">
                <li>Payments for linked products add credits automatically</li>
                <li>Bookings on your class calendars take a credit; members with none get a buy link</li>
                <li>Cancellations follow your {settings.policy.cancelWindowHours}-hour rule, and freed seats go to the waitlist</li>
                <li>Each member’s balance shows on their contact as a custom field and tags you can use in workflows</li>
              </ul>
              <p className="muted small">Going live adds two contact fields: “ClassKit Credits” and “ClassKit Credits Expire”.</p>
            </>
          )}
        </div>

        <footer className="wizard-foot">
          {step > 0 ? <button className="btn ghost" onClick={() => setStep(step - 1)}><Icon name="chevL" size={14} /> Back</button> : <span />}
          <span className="grow muted small center">Step {step + 1} of {STEPS.length}</span>
          {step === 2 && <button className="btn ghost" disabled={saving} onClick={() => next(true)}>Skip for now</button>}
          <button className="btn primary" disabled={saving} onClick={() => next(false)}>
            {saving ? 'Saving…' : step === 3 ? 'Go live' : step === 2 ? 'Create package' : 'Continue'} {!saving && step < 3 && <Icon name="chevR" size={14} />}
          </button>
        </footer>
      </div>
    </div>
  );
}
