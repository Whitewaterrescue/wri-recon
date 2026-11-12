/* WRI Field Forms — floating ICS 214 button for other pages on this origin (2026-11-12).
 *
 * The Safety, Logistics and Ops dashboards load this file when a response viewer
 * opens them in their own tab. It adds a red "LOG 214" button that opens Field
 * Forms' 214 tab (?embed=214) in a panel, the same one the Field App and the
 * Gateway show. Field Forms is on the same origin (whitewaterrescue.github.io),
 * so the panel shares its saved name, incident PIN and offline outbox.
 *
 * It does nothing inside a frame or with ?from=fieldapp: the Field App shows the
 * dashboards in its own overlay and its LOG 214 button already floats on top.
 *
 * The host page may set, before or after this loads:
 *   window.WRI_214_HOST = {
 *     incident: 'key or id' | function () { return 'key or id'; },   // else Field Forms uses the device's pick
 *     section:  'safety' | 'logistics' | 'operations' | …,            // unit log preselected in the panel
 *     user:     'name' | function () { return 'name'; }                  // the page's signed-in person (D2/D4 2026-11-12)
 *   };
 * A host's signed-in name wins over this device's saved name: on a shared desk PC the panel said
 * "Logging as PW-TEST Morgan" (the last Field Forms user) while the dashboard was signed in as someone else.
 *
 * Self-contained: its styles are inlined and it needs nothing from the host page.
 * Ported from wri-respond/js/ics214.js; keep the service-worker refresh and the
 * "old copy" check in step with it and with the Field App's ics214-fab widget.
 */
(function () {
  if (window.__wri214Host) return;
  var framed = true;
  try { framed = window.self !== window.top; } catch (e) {}
  if (framed || /[?&]from=fieldapp(&|#|$)/.test(location.search)) return;
  window.__wri214Host = true;

  var FORMS = 'https://whitewaterrescue.github.io/wri-recon/';
  var LABEL = 'LOG 214';
  var fab, panel, frame, loadEl, staleEl, retryBtn, src = '', opening = false, okTimer = null;

  var CSS =
    '.wri-214-fab{position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:9400;min-width:54px;height:44px;' +
      'border-radius:22px;border:2px solid #fff;background:#EC2329;color:#fff;font:800 14px/1 system-ui,sans-serif;letter-spacing:.3px;' +
      'box-shadow:0 3px 10px rgba(0,0,0,.45);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 14px}' +
    '.wri-214-fab.ok{background:#16a34a}.wri-214-fab:active{transform:scale(.95)}' +
    '.wri-214-fab.hidden,.wri-214-panel.hidden,.wri-214-load.hidden{display:none}' +
    '.wri-214-panel{position:fixed;z-index:9500;top:0;bottom:0;right:0;width:440px;max-width:100vw;background:#171919;display:flex;' +
      'flex-direction:column;box-shadow:0 0 24px rgba(0,0,0,.6)}' +
    '@media (max-width:700px){.wri-214-panel{left:0;width:auto}}' +
    '.wri-214-bar{display:flex;align-items:center;gap:10px;background:#3A3C3C;color:#fff;padding:10px 12px;' +
      'padding-top:calc(10px + env(safe-area-inset-top,0px))}' +
    '.wri-214-bar b{flex:1;font:700 16px system-ui,sans-serif}' +
    '.wri-214-x{background:#1c1e21;color:#fff;border:1px solid #55595a;border-radius:18px;padding:7px 14px;font:700 14px system-ui,sans-serif;cursor:pointer}' +
    '.wri-214-x:disabled{opacity:.6;cursor:default}' +
    '.wri-214-body{position:relative;flex:1}' +
    '.wri-214-body iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;background:#171919}' +
    '.wri-214-load{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;gap:10px;color:#d1d5db;' +
      'font:600 14px system-ui,sans-serif;background:#171919}' +
    '.wri-214-spin{width:18px;height:18px;border:3px solid #55595a;border-top-color:#EC2329;border-radius:50%;animation:wri214spin .8s linear infinite}' +
    '.wri-214-stale{flex-direction:column;gap:14px;padding:24px;text-align:center;line-height:1.45}' +
    '@keyframes wri214spin{to{transform:rotate(360deg)}}';

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

  // Ask this device's Field Forms service worker to update before the panel loads it.
  function freshenForms() {
    try {
      var sw = navigator.serviceWorker;
      if (!sw || !navigator.onLine) return Promise.resolve();
      return sw.getRegistration(new URL(FORMS).pathname).then(function (reg) {
        if (!reg) return;
        return Promise.race([reg.update(), wait(8000)]).then(function () {
          var next = reg.installing || reg.waiting;
          if (!next) return;
          return Promise.race([new Promise(function (resolve) {
            var done = function () { if (next.state === 'activated' || next.state === 'redundant') resolve(); };
            next.addEventListener('statechange', done); done();
          }), wait(4000)]);
        });
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  function isEmbed214() {
    try {
      var w = frame && frame.contentWindow;
      return !!(w && w.CONFIG && w.CONFIG.QUICK_214 && w.document.body.classList.contains('embed'));
    } catch (e) { return true; }   // not readable (another origin): trust it
  }

  function hostIncident() {
    var c = window.WRI_214_HOST || {}, v = '';
    try { v = typeof c.incident === 'function' ? c.incident() : c.incident; } catch (e) {}
    return String(v == null ? '' : v).trim();
  }
  function checkedInName() {
    try { var c = JSON.parse(lsGet('wri_checkin_state') || 'null'); return c && c.name ? String(c.name).trim() : ''; } catch (e) { return ''; }
  }
  function hostUser() {
    var c = window.WRI_214_HOST || {}, v = '';
    try { v = typeof c.user === 'function' ? c.user() : c.user; } catch (e) {}
    return String(v == null ? '' : v).trim();
  }
  function wantUrl() {
    var inc = hostIncident(), name = hostUser() || checkedInName();
    var sec = String((window.WRI_214_HOST || {}).section || '').toLowerCase();
    return FORMS + '?embed=214' + (inc ? '&incident=' + encodeURIComponent(inc) : '') +
      (name ? '&name=' + encodeURIComponent(name) : '') +
      (/^(command|operations|planning|logistics|finance|safety)$/.test(sec) ? '&section=' + sec : '') + '#214';
  }

  function openPanel(retry) {
    if (opening) return;
    var want = wantUrl();
    show(panel, true); fab.classList.add('hidden');
    if (want === src && !retry && !panel.classList.contains('stale')) {
      try { frame.contentWindow.postMessage({ type: 'wri-214', action: 'open' }, location.origin); } catch (e) {}
      return;
    }
    opening = true; panel.classList.remove('stale');
    show(loadEl, true); show(staleEl, false);
    retryBtn.disabled = true; retryBtn.textContent = 'Updating…';
    freshenForms().then(function () {
      opening = false; retryBtn.disabled = false; retryBtn.textContent = 'Retry';
      if (want === src) { try { frame.contentWindow.location.reload(); return; } catch (e) {} }
      src = want; frame.src = want;
    });
  }
  function closePanel() { show(panel, false); fab.classList.remove('hidden'); }

  function build() {
    var st = document.createElement('style');
    st.textContent = CSS; document.head.appendChild(st);

    fab = document.createElement('button');
    fab.type = 'button'; fab.className = 'wri-214-fab'; fab.textContent = LABEL;
    fab.title = 'ICS 214 activity log'; fab.setAttribute('aria-label', 'Open the ICS 214 activity log');
    fab.addEventListener('click', function () { openPanel(false); });
    document.body.appendChild(fab);

    panel = document.createElement('div');
    panel.className = 'wri-214-panel hidden'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'ICS 214 activity log');
    panel.innerHTML =
      '<div class="wri-214-bar"><b>ICS 214 Log</b><button type="button" class="wri-214-x">Close &#x2715;</button></div>' +
      '<div class="wri-214-body"><iframe title="ICS 214 log"></iframe>' +
      '<div class="wri-214-load"><span class="wri-214-spin"></span>Opening the 214 log&hellip;</div>' +
      '<div class="wri-214-load wri-214-stale hidden"><div>The 214 log saved on this device is an old copy, so it can&rsquo;t open here yet.</div>' +
      '<div>Get signal, then tap Retry.</div><button type="button" class="wri-214-x">Retry</button></div></div>';
    document.body.appendChild(panel);
    frame = panel.querySelector('iframe');
    loadEl = panel.querySelector('.wri-214-load');
    staleEl = panel.querySelector('.wri-214-stale');
    retryBtn = staleEl.querySelector('button');
    panel.querySelector('.wri-214-bar .wri-214-x').addEventListener('click', closePanel);
    retryBtn.addEventListener('click', function () { openPanel(true); });
    frame.addEventListener('load', function () {
      if (!src) return;
      show(loadEl, false);
      var ok = isEmbed214();
      panel.classList.toggle('stale', !ok); show(staleEl, !ok);
    });

    // "saved" from the panel: flash the button green (useful once it's closed)
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (e.origin !== location.origin || !d || d.type !== 'wri-214' || d.action !== 'saved') return;
      fab.classList.add('ok'); fab.textContent = '✓';
      clearTimeout(okTimer);
      okTimer = setTimeout(function () { fab.classList.remove('ok'); fab.textContent = LABEL; }, 3000);
    });
  }

  window.WRI214Host = { open: function () { if (fab) openPanel(false); }, close: function () { if (panel) closePanel(); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
