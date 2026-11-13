import React, { useEffect } from 'react';
import { initials } from '../lib/format.js';

const PATHS = {
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  ticket: <><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" /><path d="M14 5v2M14 11v2M14 17v2" /></>,
  chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  chevL: <path d="m15 18-6-6 6-6" />,
  chevR: <path d="m9 18 6-6-6-6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  infinity: <path d="M18.18 8.64a4.5 4.5 0 1 1 0 6.72L12 12l-6.18 3.36a4.5 4.5 0 1 1 0-6.72L12 12z" />,
  alert: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  tablet: <><rect x="4" y="2" width="16" height="20" rx="2.5" /><path d="M11 18h2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
  palette: <><circle cx="12" cy="12" r="9" /><circle cx="8" cy="10" r="1.2" /><circle cx="12" cy="7.5" r="1.2" /><circle cx="16" cy="10" r="1.2" /><path d="M12 21a3 3 0 0 1 0-6h2a3 3 0 0 0 3-3" /></>,
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  sliders: <><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></>
};

export function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Spinner({ full = true }) {
  return <div className={full ? 'spinner-wrap' : 'spinner-inline'}><div className="spinner" /></div>;
}

export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast?.message) return undefined;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast?.message) return null;
  return <div className={`toast ${toast.error ? 'err' : ''}`} role="status">{toast.message}</div>;
}

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ name, size = 32 }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>;
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Number box that can be emptied while typing (no stuck "0", no "01").
 * Calls onChange(number) for every valid value; on blur an empty or too-small value snaps back to `min`.
 */
export function NumberInput({ value, onChange, min, max, ...rest }) {
  const [text, setText] = React.useState(value ?? '');
  React.useEffect(() => {
    setText((t) => (t !== '' && Number(t) === Number(value) ? t : (value ?? '')));
  }, [value]);
  const lo = min != null ? Number(min) : null;
  const hi = max != null ? Number(max) : null;
  return (
    <input
      type="number" inputMode="numeric" min={min} max={max} {...rest}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw !== '' && Number.isFinite(Number(raw))) onChange(Number(raw));
      }}
      onBlur={(e) => {
        let n = Number(text);
        if (text === '' || !Number.isFinite(n)) n = lo ?? 0;
        if (lo != null && n < lo) n = lo;
        if (hi != null && n > hi) n = hi;
        setText(String(n));
        if (n !== Number(value)) onChange(n);
        rest.onBlur?.(e);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-dot" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function CopyLink({ url, notify }) {
  return (
    <div className="copylink">
      <code>{url}</code>
      <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(url); notify?.('Link copied'); }}><Icon name="copy" size={14} /> Copy</button>
      <a className="btn sm ghost" href={url} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Open</a>
    </div>
  );
}

export function Credits({ member }) {
  if (member?.unlimitedUntil && new Date(member.unlimitedUntil) > new Date()) return <Badge tone="accent"><Icon name="infinity" size={13} /> Unlimited</Badge>;
  const n = member?.balance ?? 0;
  return <Badge tone={n === 0 ? 'crit' : n <= 2 ? 'warn' : 'good'}>{n} credit{n === 1 ? '' : 's'}</Badge>;
}
