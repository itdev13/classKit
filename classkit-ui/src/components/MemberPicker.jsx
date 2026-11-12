import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Avatar, Credits, Field, Icon } from './ui.jsx';

/** Search existing members, or add a new one (creates/merges the GHL contact). */
export default function MemberPicker({ value, onChange, notify }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });

  useEffect(() => {
    if (value || adding) return undefined;
    const t = setTimeout(() => {
      api.members({ q }).then((r) => setResults(r.members.slice(0, 6))).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, value, adding]);

  if (value) {
    return (
      <div className="picked">
        <Avatar name={value.name} size={34} />
        <div><strong>{value.name}</strong><small>{value.phone || value.email}</small></div>
        <Credits member={value} />
        <button className="icon-btn" onClick={() => onChange(null)} aria-label="Change member"><Icon name="x" /></button>
      </div>
    );
  }

  if (adding) {
    const save = async () => {
      try {
        const r = await api.createMember(form);
        onChange(r.member);
        setAdding(false);
      } catch (e) { notify(e.message, true); }
    };
    return (
      <div className="stack">
        <div className="grid2">
          <Field label="Full name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya Shah" autoFocus /></Field>
          <Field label="Mobile"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 010 2030" /></Field>
        </div>
        <Field label="Email (optional)"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="priya@example.com" /></Field>
        <div className="row gap"><button className="btn primary sm" onClick={save}>Add member</button><button className="btn ghost sm" onClick={() => setAdding(false)}>Back to search</button></div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or email" autoFocus /></div>
      <ul className="pick-list">
        {results.map((m) => (
          <li key={m.contactId}><button onClick={() => onChange(m)}><Avatar name={m.name} size={28} /><span>{m.name}<small>{m.phone || m.email}</small></span><Credits member={m} /></button></li>
        ))}
        {!results.length && <li className="muted small pad">No members found.</li>}
      </ul>
      <button className="btn ghost sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> New member</button>
    </div>
  );
}
