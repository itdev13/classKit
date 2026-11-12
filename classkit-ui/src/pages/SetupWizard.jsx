import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { CalendarsEditor, PolicyEditor } from '../components/Editors.jsx';
import { Field, Spinner } from '../components/ui.jsx';

const STEPS = ['Class calendars', 'Booking rules', 'First package', 'Go live'];

export default function SetupWizard({ isAdmin, notify, onDone }) {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState(null);
  const [calendars, setCalendars] = useState(null);
  const [pkg, setPkg] = useState({ name: '10-Class Pack', kind: 'pack', credits: 10, validityDays: 90, priceUsd: 150, ghlProductIds: [] });
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings().then((r) => setSettings(r.settings)).catch((e) => notify(e.message, true));
    api.calendars().then((r) => setCalendars(r.calendars.map((c) => ({ ...c, enabled: c.enabled || /class/i.test(c.calendarType || '') })))).catch((e) => { notify(e.message, true); setCalendars([]); });
    api.products().then((r) => setProducts(r.products)).catch(() => {});
  }, [notify]);

  if (!isAdmin) {
    return <div className="center-screen"><div className="card narrow"><h2>ClassKit isn't set up yet</h2><p className="muted">Ask a sub-account admin to open ClassKit and finish setup.</p></div></div>;
  }
  if (!settings || !calendars) return <Spinner />;

  const next = async () => {
    setSaving(true);
    try {
      if (step === 0) {
        if (!calendars.some((c) => c.enabled)) throw new Error('Turn on at least one class calendar');
        await api.saveSettings({ calendars });
      }
      if (step === 1) await api.saveSettings({ policy: settings.policy, buyUrl: settings.buyUrl });
      if (step === 2 && pkg.name) await api.createPackage(pkg);
      if (step === 3) {
        await api.completeSetup();
        return onDone();
      }
      setStep(step + 1);
    } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };

  return (
    <div className="wizard">
      <div className="wizard-head">
        <img src="/icon.svg" alt="" width="40" height="40" />
        <div><h1>Set up ClassKit</h1><p className="muted">About 3 minutes. You can change everything later in Settings.</p></div>
      </div>
      <ol className="steps">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}><span>{i + 1}</span>{s}</li>)}</ol>

      <div className="card wizard-body">
        {step === 0 && (
          <>
            <h2>Which calendars are your classes?</h2>
            <p className="muted">Bookings on these calendars use credits. Leave consultation and other calendars off.</p>
            <CalendarsEditor calendars={calendars} onChange={setCalendars} />
          </>
        )}
        {step === 1 && (
          <>
            <h2>Your booking rules</h2>
            <PolicyEditor policy={settings.policy} onChange={(p) => setSettings({ ...settings, policy: p })} />
            <Field label="Buy link" hint="Where members can buy a pack (payment link or funnel). Sent when they run out.">
              <input value={settings.buyUrl} onChange={(e) => setSettings({ ...settings, buyUrl: e.target.value })} placeholder="https://yourstudio.com/class-packs" />
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Create your first package</h2>
            <p className="muted">Link it to a HighLevel product so paying for it adds credits automatically. You can add more later.</p>
            <div className="grid3">
              <Field label="Name"><input value={pkg.name} onChange={(e) => setPkg({ ...pkg, name: e.target.value })} /></Field>
              <Field label="Credits"><input type="number" min="1" value={pkg.credits} onChange={(e) => setPkg({ ...pkg, credits: Number(e.target.value) })} /></Field>
              <Field label="Valid for (days)"><input type="number" min="1" value={pkg.validityDays} onChange={(e) => setPkg({ ...pkg, validityDays: Number(e.target.value) })} /></Field>
            </div>
            <Field label="HighLevel product">
              <select value={pkg.ghlProductIds[0] || ''} onChange={(e) => setPkg({ ...pkg, ghlProductIds: e.target.value ? [e.target.value] : [] })}>
                <option value="">Not linked yet</option>
                {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
              </select>
            </Field>
            <button className="btn ghost sm" onClick={() => { setPkg({ ...pkg, name: '' }); setStep(3); }}>Skip for now</button>
          </>
        )}
        {step === 3 && (
          <>
            <h2>You're ready</h2>
            <ul className="ticks">
              <li>Payments for linked products add credits automatically</li>
              <li>Bookings on your class calendars take a credit, and members with none get a buy link</li>
              <li>Cancellations follow your {settings.policy.cancelWindowHours}-hour rule, and freed seats go to the waitlist</li>
              <li>Each contact's credit balance shows as a custom field and tag you can use in workflows</li>
            </ul>
            <p className="muted small">Going live adds two custom fields to your contacts: “ClassKit Credits” and “ClassKit Credits Expire”.</p>
          </>
        )}
      </div>

      <div className="wizard-foot">
        {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
        <span className="grow" />
        <button className="btn primary" disabled={saving} onClick={next}>{step === 3 ? 'Go live' : 'Continue'}</button>
      </div>
    </div>
  );
}
