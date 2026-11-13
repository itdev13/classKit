import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, getCurrency } from '../lib/format.js';
import { Badge, Empty, Field, Icon, Modal, Spinner, NumberInput } from '../components/ui.jsx';

const KIND_LABEL = { pack: 'Class pack', unlimited: 'Unlimited', dropin: 'Drop-in' };

export default function Packages({ isAdmin, notify }) {
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.packages().then((r) => setList(r.packages)).catch((e) => notify(e.message, true)), [notify]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Packages</h1><p className="muted">What you sell. Link each one to a HighLevel product so paying adds credits automatically.</p></div>
        {isAdmin && <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" /> New package</button>}
      </div>
      {!list ? <Spinner full={false} /> : list.length === 0 ? (
        <Empty title="Create your first package" action={isAdmin && <button className="btn primary" onClick={() => setEdit({})}>New package</button>}>
          For example a 10-class pack valid for 90 days, or an unlimited monthly membership.
        </Empty>
      ) : (
        <div className="pkg-grid">
          {list.map((p) => (
            <div key={p._id} className={`card pkg ${p.active ? '' : 'archived'}`}>
              <div className="row between">
                <Badge tone={p.kind === 'unlimited' ? 'accent' : 'neutral'}>{KIND_LABEL[p.kind]}</Badge>
                {!p.active && <Badge tone="muted">Archived</Badge>}
              </div>
              <h3>{p.name}</h3>
              <div className="pkg-big">{p.kind === 'unlimited' ? <><Icon name="infinity" size={22} /> Unlimited</> : `${p.credits} credit${p.credits === 1 ? '' : 's'}`}</div>
              <p className="muted small">{p.priceUsd ? money(p.priceUsd) : 'No price set'} · valid {p.validityDays} days</p>
              <p className="small">{p.ghlProductIds.length || p.ghlPriceIds.length
                ? <span className="good-text"><Icon name="link" size={13} /> Linked to {p.ghlProductIds.length + p.ghlPriceIds.length} product{p.ghlProductIds.length + p.ghlPriceIds.length === 1 ? '' : 's'}</span>
                : <span className="warn-text"><Icon name="alert" size={13} /> Not linked — sales won't add credits</span>}</p>
              <p className="muted small">{p.sold} sold</p>
              {isAdmin && <button className="btn sm" onClick={() => setEdit(p)}><Icon name="edit" size={14} /> Edit</button>}
            </div>
          ))}
        </div>
      )}
      {edit && <PackageModal pkg={edit} notify={notify} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function PackageModal({ pkg, notify, onClose, onSaved }) {
  const isNew = !pkg._id;
  const [f, setF] = useState({
    name: pkg.name || '', kind: pkg.kind || 'pack', credits: pkg.credits ?? 10, validityDays: pkg.validityDays ?? 90,
    priceUsd: pkg.priceUsd ?? 0, ghlProductIds: pkg.ghlProductIds || [], ghlPriceIds: pkg.ghlPriceIds || [],
    calendarIds: pkg.calendarIds || [], active: pkg.active ?? true
  });
  const [products, setProducts] = useState(null);
  const [calendars, setCalendars] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api.products().then((r) => setProducts(r.products)).catch(() => setProducts([]));
    api.settings().then((r) => setCalendars(r.settings.calendars.filter((c) => c.usesCredits))).catch(() => {});
  }, []);

  const toggle = (k, id) => set(k, f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id]);

  const save = async () => {
    setSaving(true);
    try {
      if (isNew) await api.createPackage(f); else await api.updatePackage(pkg._id, f);
      notify(isNew ? 'Package created' : 'Package saved');
      onSaved();
    } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };
  const remove = async () => {
    try { const r = await api.deletePackage(pkg._id); notify(r.archived ? 'Package archived (it has sales)' : 'Package deleted'); onSaved(); } catch (e) { notify(e.message, true); }
  };

  return (
    <Modal wide title={isNew ? 'New package' : `Edit ${pkg.name}`} onClose={onClose}
      footer={<>
        {!isNew && <button className="btn ghost danger-text" onClick={remove}><Icon name="trash" size={14} /> {pkg.sold ? 'Archive' : 'Delete'}</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={saving || !f.name} onClick={save}>{isNew ? 'Create package' : 'Save'}</button>
      </>}>
      <div className="grid2">
        <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="10-Class Pack" autoFocus /></Field>
        <Field label="Type">
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="pack">Class pack (N credits)</option>
            <option value="unlimited">Unlimited (time-based)</option>
            <option value="dropin">Drop-in (1 credit)</option>
          </select>
        </Field>
      </div>
      <div className="grid3">
        {f.kind !== 'unlimited' && <Field label="Credits"><NumberInput min="1" value={f.credits} onChange={(v) => set('credits', v)} /></Field>}
        <Field label="Valid for (days)" hint={f.kind === 'unlimited' ? 'Match your billing period, e.g. 31 for monthly.' : undefined}><NumberInput min="1" value={f.validityDays} onChange={(v) => set('validityDays', v)} /></Field>
        <Field label={`Price (${getCurrency()})`} hint="For reports only — HighLevel charges the card."><NumberInput min="0" step="1" value={f.priceUsd} onChange={(v) => set('priceUsd', v)} /></Field>
      </div>

      <h4 className="section-label">Linked HighLevel products</h4>
      <p className="muted small">When a contact pays for one of these (checkout, payment link, invoice), they get this package.</p>
      {!products ? <Spinner full={false} /> : products.length === 0 ? <p className="small warn-text">No products found in Payments → Products. Create one there first.</p> : (
        <div className="check-list">
          {products.map((p) => (
            <label key={p.productId} className="check">
              <input type="checkbox" checked={f.ghlProductIds.includes(p.productId)} onChange={() => toggle('ghlProductIds', p.productId)} />
              <span>{p.name}{p.prices?.length ? <small className="muted"> · {p.prices.map((pr) => `${pr.name || 'price'} ${pr.amount != null ? money(pr.amount, pr.currency || undefined) : ''}`).join(', ')}</small> : null}</span>
            </label>
          ))}
        </div>
      )}

      {calendars.length > 1 && (
        <>
          <h4 className="section-label">Valid for classes</h4>
          <p className="muted small">Leave all unticked to allow every class.</p>
          <div className="check-list">
            {calendars.map((c) => (
              <label key={c.calendarId} className="check">
                <input type="checkbox" checked={f.calendarIds.includes(c.calendarId)} onChange={() => toggle('calendarIds', c.calendarId)} />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
      {!isNew && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /><span>Active (can be sold)</span></label>}
    </Modal>
  );
}
