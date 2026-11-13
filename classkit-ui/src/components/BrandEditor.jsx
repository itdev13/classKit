import React, { useRef, useState } from 'react';
import { Field, Icon } from './ui.jsx';

const SWATCHES = ['#5B4BDB', '#0F766E', '#2563EB', '#DB2777', '#EA580C', '#16A34A', '#111827', '#B45309'];
const MAX_SIDE = 256;

/** Shrink an uploaded image to at most 256px and return a PNG data URL (keeps transparency). */
function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) return reject(new Error('Use a PNG, JPG, WebP, GIF or SVG image'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('Image is over 5 MB'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width || MAX_SIDE, img.height || MAX_SIDE));
      const w = Math.max(1, Math.round((img.width || MAX_SIDE) * scale));
      const h = Math.max(1, Math.round((img.height || MAX_SIDE) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

export function BrandMark({ brand, fallbackName, size = 32 }) {
  const name = brand?.name || fallbackName || 'Studio';
  if (brand?.logoUrl) return <img className="brand-logo" src={brand.logoUrl} alt="" style={{ width: size, height: size }} />;
  return <span className="brand-initial" style={{ width: size, height: size, background: brand?.color || 'var(--accent)', fontSize: size * 0.45 }}>{name.trim()[0]?.toUpperCase() || 'S'}</span>;
}

/** Studio logo, name and colour, with a live preview of how members and staff will see it. */
export default function BrandEditor({ brand, locationName, onChange, notify }) {
  const fileRef = useRef(null);
  const [showUrl, setShowUrl] = useState(false);
  const set = (patch) => onChange({ ...brand, ...patch });
  const isData = (brand.logoUrl || '').startsWith('data:');

  const upload = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { set({ logoUrl: await fileToLogo(f) }); notify('Logo added. Save changes to apply it.'); } catch (err) { notify(err.message, true); }
  };

  return (
    <div className="brand-editor">
      <div className="brand-fields">
        <Field label="Logo" hint="Square works best. Shown in ClassKit, on the kiosk, the class schedule and the website widget.">
          <div className="logo-row">
            <div className="logo-tile"><BrandMark brand={brand} fallbackName={locationName} size={56} /></div>
            <div className="logo-actions">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange={upload} />
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}><Icon name="plus" size={14} /> {brand.logoUrl ? 'Change logo' : 'Upload logo'}</button>
              {brand.logoUrl && <button type="button" className="btn sm ghost" onClick={() => set({ logoUrl: '' })}>Remove</button>}
              <button type="button" className="link small" onClick={() => setShowUrl(!showUrl)}>{showUrl ? 'Hide link' : 'or paste a link'}</button>
            </div>
          </div>
          {showUrl && <input value={isData ? '' : brand.logoUrl} onChange={(e) => set({ logoUrl: e.target.value.trim() })} placeholder="https://yourstudio.com/logo.png" style={{ marginTop: 8 }} />}
        </Field>
        <Field label="Studio name" hint="Shown to staff and members instead of the sub-account name.">
          <input value={brand.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder={locationName || 'Your studio'} />
        </Field>
        <Field label="Brand colour" hint="Used for buttons and highlights in ClassKit, the kiosk, schedule and widget.">
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button key={c} type="button" className={`swatch${brand.color?.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Use ${c}`} />
            ))}
            <label className="swatch custom" title="Pick any colour">
              <input type="color" value={brand.color || '#5B4BDB'} onChange={(e) => set({ color: e.target.value })} />
            </label>
          </div>
        </Field>
      </div>

      <div className="brand-preview" style={{ '--accent': brand.color || '#5B4BDB' }}>
        <span className="small muted">Preview</span>
        <div className="preview-bar">
          <BrandMark brand={brand} fallbackName={locationName} size={30} />
          <div><strong>{brand.name || locationName || 'Your studio'}</strong><small>Classes · Members · Packages</small></div>
        </div>
        <div className="preview-body">
          <span className="preview-pill">Yoga · 7:00 AM</span>
          <button type="button" className="btn primary sm" tabIndex={-1}>Book a class</button>
        </div>
      </div>
    </div>
  );
}
