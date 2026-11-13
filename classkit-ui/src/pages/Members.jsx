import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDate, fmtDateTime, fromNow, isUnlimited, money } from '../lib/format.js';
import { Avatar, Badge, Credits, Empty, Field, Icon, Modal, Spinner } from '../components/ui.jsx';
import MemberPicker from '../components/MemberPicker.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'low', label: 'Low credits' },
  { id: 'expiring', label: 'Expiring soon' },
  { id: 'inactive', label: 'Not seen in 14 days' },
  { id: 'unlimited', label: 'Unlimited' }
];

export default function Members({ tz, notify, openId, setOpenId }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.members({ q, filter }).then(setData).catch((e) => notify(e.message, true));
  }, [q, filter, notify]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  return (
    <div className="page split">
      <div className="list-col">
        <div className="page-head">
          <div><h1>Members</h1><p className="muted">{data ? `${data.total} member${data.total === 1 ? '' : 's'}` : ' '}</p></div>
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add member</button>
        </div>
        <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or email" /></div>
        <div className="chips">
          {FILTERS.map((f) => <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        {!data ? <Spinner full={false} /> : data.members.length === 0 ? (
          <Empty title="No members here yet">Members appear when they buy a package or book a class calendar that uses credits.</Empty>
        ) : (
          <ul className="member-list">
            {data.members.map((m) => (
              <li key={m.contactId}>
                <button className={openId === m.contactId ? 'sel' : ''} onClick={() => setOpenId(m.contactId)}>
                  <Avatar name={m.name} />
                  <span className="grow"><strong>{m.name}</strong><small>{m.lastVisitAt ? `Last visit ${fromNow(m.lastVisitAt)}` : 'No visits yet'} · {m.visits} visit{m.visits === 1 ? '' : 's'}</small></span>
                  <Credits member={m} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="detail-col">
        {openId ? <MemberDetail key={openId} contactId={openId} tz={tz} notify={notify} onChanged={load} onClose={() => setOpenId(null)} />
          : <Empty title="Select a member">See their credits, history and bookings, sell a package, or adjust their balance.</Empty>}
      </div>
      {adding && (
        <Modal title="Add member" onClose={() => setAdding(false)}>
          <MemberPicker value={null} notify={notify} onChange={(m) => { if (m) { setAdding(false); setOpenId(m.contactId); load(); } }} />
        </Modal>
      )}
    </div>
  );
}

const REASON = { purchase: 'Purchased', booking: 'Booked class', refund: 'Refund', late_cancel: 'Late cancel', expire: 'Expired', adjust: 'Adjustment', revoke: 'Revoked' };
const BOOKING_TONE = { booked: 'neutral', attended: 'good', noshow: 'crit', cancelled: 'muted', rejected: 'warn' };
const BOOKING_LABEL = { booked: 'Booked', attended: 'Attended', noshow: 'No-show', cancelled: 'Cancelled', rejected: 'Blocked — no credits' };

function MemberDetail({ contactId, tz, notify, onChanged, onClose }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('history');
  const [modal, setModal] = useState(null);

  const load = useCallback(() => api.member(contactId).then(setD).catch((e) => notify(e.message, true)), [contactId, notify]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged(); };

  if (!d) return <Spinner full={false} />;
  const m = d.member;
  const liveLots = d.lots.filter((l) => l.status === 'active');

  return (
    <div className="card detail">
      <div className="detail-head">
        <Avatar name={m.name} size={48} />
        <div className="grow">
          <h2>{m.name}</h2>
          <p className="muted small">{[m.phone, m.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>

      <div className="balance-row">
        <div className="big-stat">
          <span className="label">Balance</span>
          <span className="value">{isUnlimited(m) ? <><Icon name="infinity" size={26} /> Unlimited</> : m.balance}</span>
          <span className="small muted">{isUnlimited(m) ? `until ${fmtDate(m.unlimitedUntil, tz)}` : m.nextExpiry ? `next expiry ${fmtDate(m.nextExpiry, tz)}` : 'no active credits'}</span>
        </div>
        <div className="mini-stats">
          <div><strong>{m.visits}</strong><span>visits</span></div>
          <div><strong>{m.noShows}</strong><span>no-shows</span></div>
          <div><strong>{fromNow(m.lastVisitAt)}</strong><span>last visit</span></div>
        </div>
      </div>

      <div className="row gap">
        <button className="btn primary" onClick={() => setModal('sell')}><Icon name="ticket" /> Sell package</button>
        <button className="btn" onClick={() => setModal('adjust')}><Icon name="edit" /> Adjust credits</button>
      </div>

      {liveLots.length > 0 && (
        <div className="lots">
          {liveLots.map((l) => (
            <div className="lot" key={l._id}>
              <div><strong>{l.packageName}</strong><small>{l.kind === 'unlimited' ? 'Unlimited' : `${l.remaining} of ${l.creditsTotal} left`} · expires {fmtDate(l.expiresAt, tz)}</small></div>
              {l.kind !== 'unlimited' && <div className="bar slim"><div style={{ width: `${Math.round((l.remaining / Math.max(1, l.creditsTotal)) * 100)}%` }} /></div>}
              <button className="icon-btn" title="Revoke this package" onClick={() => setModal({ revoke: l })}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="subtabs">
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Credit history</button>
        <button className={tab === 'bookings' ? 'on' : ''} onClick={() => setTab('bookings')}>Bookings</button>
      </div>

      {tab === 'history' ? (
        d.ledger.length === 0 ? <p className="muted small pad">No credit activity yet.</p> : (
          <table className="table">
            <thead><tr><th>When</th><th>What</th><th className="num">Change</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {d.ledger.map((e) => (
                <tr key={e._id}>
                  <td className="nowrap">{fmtDateTime(e.createdAt, tz)}</td>
                  <td>{REASON[e.reason] || e.reason}{e.note && <small className="muted block">{e.note}{e.actor && e.actor !== 'system' ? ` — ${e.actor}` : ''}</small>}</td>
                  <td className={`num ${e.delta > 0 ? 'pos' : e.delta < 0 ? 'neg' : ''}`}>{e.delta > 0 ? `+${e.delta}` : e.delta || '—'}</td>
                  <td className="num">{e.balanceAfter ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        d.bookings.length === 0 ? <p className="muted small pad">No bookings yet.</p> : (
          <table className="table">
            <thead><tr><th>Class</th><th>When</th><th>Status</th></tr></thead>
            <tbody>
              {d.bookings.map((b) => (
                <tr key={b._id}>
                  <td>{b.className}</td>
                  <td className="nowrap">{fmtDateTime(b.startTime, tz)}</td>
                  <td><Badge tone={BOOKING_TONE[b.status]}>{BOOKING_LABEL[b.status]}</Badge>{b.lateCancel && <small className="muted block">late cancel — credit kept</small>}{b.refunded && <small className="muted block">credit refunded</small>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {modal === 'sell' && <SellModal contactId={contactId} name={m.name} notify={notify} onClose={() => setModal(null)} onDone={() => { setModal(null); changed(); }} />}
      {modal === 'adjust' && <AdjustModal contactId={contactId} name={m.name} notify={notify} onClose={() => setModal(null)} onDone={() => { setModal(null); changed(); }} />}
      {modal?.revoke && (
        <Modal title="Revoke package" onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Keep it</button>
          <button className="btn danger" onClick={async () => { try { await api.revokeLot(contactId, modal.revoke._id); notify('Package revoked'); setModal(null); changed(); } catch (e) { notify(e.message, true); } }}>Revoke</button></>}>
          <p>Remove <strong>{modal.revoke.packageName}</strong> from {m.name}? {modal.revoke.kind !== 'unlimited' && `Their ${modal.revoke.remaining} remaining credits from it are removed.`} Use this for refunded purchases or mistakes.</p>
          <p className="muted small">This doesn't refund money — do that in Payments.</p>
        </Modal>
      )}
    </div>
  );
}

function SellModal({ contactId, name, notify, onClose, onDone }) {
  const [packages, setPackages] = useState(null);
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.packages().then((r) => { const act = r.packages.filter((p) => p.active); setPackages(act); setPick(act[0]?._id || ''); }); }, []);
  const save = async () => {
    setSaving(true);
    try { await api.grant(contactId, { packageId: pick, note: note || 'Sold at front desk' }); notify(`Package added for ${name}`); onDone(); } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Sell a package to ${name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!pick || saving} onClick={save}>Add package</button></>}>
      {!packages ? <Spinner full={false} /> : packages.length === 0 ? <p>Create a package first on the Packages tab.</p> : (
        <div className="stack">
          <div className="pkg-pick">
            {packages.map((p) => (
              <label key={p._id} className={`pkg-option ${pick === p._id ? 'on' : ''}`}>
                <input type="radio" name="pkg" checked={pick === p._id} onChange={() => setPick(p._id)} />
                <strong>{p.name}</strong>
                <small>{p.kind === 'unlimited' ? 'Unlimited' : `${p.credits} credits`} · {p.validityDays} days{p.priceUsd ? ` · ${money(p.priceUsd)}` : ''}</small>
              </label>
            ))}
          </div>
          <Field label="Note" hint="Shows in the member's history. Use this when they paid in person or it's a comp."><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid cash at front desk" /></Field>
          <p className="muted small">Online purchases add packages automatically — use this only for front-desk sales and comps.</p>
        </div>
      )}
    </Modal>
  );
}

function AdjustModal({ contactId, name, notify, onClose, onDone }) {
  const [delta, setDelta] = useState(1);
  const [note, setNote] = useState('');
  const [days, setDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api.adjust(contactId, { delta, note, validityDays: days }); notify('Credits updated'); onDone(); } catch (e) { notify(e.message, true); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Adjust credits for ${name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!delta || !note.trim() || saving} onClick={save}>{delta > 0 ? `Add ${delta}` : `Remove ${-delta}`}</button></>}>
      <div className="stepper">
        <button className="icon-btn" onClick={() => setDelta((d) => (d - 1 === 0 ? -1 : d - 1))} aria-label="Less"><Icon name="minus" /></button>
        <span className={delta > 0 ? 'pos' : 'neg'}>{delta > 0 ? `+${delta}` : delta}</span>
        <button className="icon-btn" onClick={() => setDelta((d) => (d + 1 === 0 ? 1 : d + 1))} aria-label="More"><Icon name="plus" /></button>
      </div>
      <Field label="Reason" hint="Required. Shows in the member's credit history."><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Class cancelled by studio" autoFocus /></Field>
      {delta > 0 && <Field label="Valid for (days)"><input type="number" min="1" value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>}
    </Modal>
  );
}
