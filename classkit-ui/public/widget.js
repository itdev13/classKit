/*!
 * ClassKit floating schedule widget.
 * Paste on any website:
 *   <script src="https://YOUR-APP/widget.js" data-schedule="https://YOUR-APP/s/SLUG" async></script>
 * Optional attributes: data-label="Book a class"  data-color="#5B4BDB"  data-position="right|left"
 */
(function () {
  if (window.__classkitWidget) return;
  window.__classkitWidget = true;

  var script = document.currentScript || (function () {
    var all = document.querySelectorAll('script[src*="widget.js"]');
    return all[all.length - 1];
  })();
  if (!script) return;

  var src = script.getAttribute('data-schedule');
  if (!src) {
    var slug = script.getAttribute('data-slug');
    if (slug) src = new URL(script.src).origin + '/s/' + slug;
  }
  if (!src) { console.warn('[ClassKit] widget: add data-schedule="…/s/your-slug" to the script tag'); return; }

  var color = /^#[0-9a-f]{3,8}$/i.test(script.getAttribute('data-color') || '') ? script.getAttribute('data-color') : '#5B4BDB';
  var label = (script.getAttribute('data-label') || 'Book a class').slice(0, 40);
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var frameSrc = src + (src.indexOf('?') === -1 ? '?' : '&') + 'embed=1';

  var css =
    '.ck-w-btn{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;display:flex;align-items:center;gap:8px;' +
    'padding:12px 18px 12px 14px;border:0;border-radius:999px;background:' + color + ';color:#fff;' +
    'font:600 15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;' +
    'box-shadow:0 10px 30px -8px rgba(20,17,43,.45);transition:transform .15s}' +
    '.ck-w-btn:hover{transform:translateY(-2px)}' +
    '.ck-w-btn svg{width:20px;height:20px;flex:none}' +
    '.ck-w-panel{position:fixed;bottom:84px;' + side + ':20px;z-index:2147483000;width:400px;height:640px;' +
    'max-height:calc(100vh - 110px);border-radius:18px;overflow:hidden;background:#fff;' +
    'box-shadow:0 30px 70px -20px rgba(20,17,43,.5);opacity:0;transform:translateY(12px) scale(.98);' +
    'pointer-events:none;transition:opacity .18s,transform .18s}' +
    '.ck-w-panel.ck-open{opacity:1;transform:none;pointer-events:auto}' +
    '.ck-w-panel iframe{width:100%;height:100%;border:0;display:block}' +
    '.ck-w-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border:0;border-radius:50%;' +
    'background:rgba(20,17,43,.08);color:#14112b;font-size:20px;line-height:32px;cursor:pointer}' +
    '@media (max-width:520px){.ck-w-panel{left:0;right:0;bottom:0;width:100%;height:100%;max-height:none;border-radius:0}' +
    '.ck-w-panel.ck-open~.ck-w-btn{display:none}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var panel = document.createElement('div');
  panel.className = 'ck-w-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);
  var close = document.createElement('button');
  close.className = 'ck-w-close';
  close.setAttribute('aria-label', 'Close');
  close.innerHTML = '&times;';
  panel.appendChild(close);

  var btn = document.createElement('button');
  btn.className = 'ck-w-btn';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18M9 15l2 2 4-4"/></svg>';
  btn.appendChild(document.createTextNode(label));

  var loaded = false;
  function setOpen(open) {
    if (open && !loaded) {
      var iframe = document.createElement('iframe');
      iframe.src = frameSrc;
      iframe.title = label;
      iframe.loading = 'lazy';
      panel.insertBefore(iframe, close);
      loaded = true;
    }
    panel.classList.toggle('ck-open', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', function () { setOpen(!panel.classList.contains('ck-open')); });
  close.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(btn);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
