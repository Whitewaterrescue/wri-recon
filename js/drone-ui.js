/* WRI Field Forms — Drone tab: file SD-card drone photos onto recon points (2026-10-26).
 *
 * 1. Pick photos (Browse -> the card -> DCIM). Only the ~128 KB header of each file is read
 *    (js/dronemeta.js): where it was taken + the EXIF preview, so 100+ photos list in seconds.
 * 2. Photos are grouped by time and place. For each group the crew either
 *    - attaches it to a recon point nearby (needs signal to list them), or
 *    - starts a NEW recon point there (location, time and photos filled in; the normal form), or
 *    - skips it.
 * 3. Everything goes through the outbox like any saved point: downscaled on the phone, kept in
 *    IndexedDB, uploaded one photo per request when there's signal. Attachments carry the photo's
 *    metadata in `keywords` (the downscale strips it from the JPEG).
 */
(function () {
  var A, $, S;
  var D = { items: [], groups: [], scanning: false, nearby: {}, state: {} };
  // state[groupId] = { filed: 'label', status: 'queued'|'sent' } once filed, or { skipped: true }
  var seq = 0;

  function fmtTime(ms) { return ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; }
  function fmtDay(ms) { return ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''; }
  function typeLabel(code) {
    var t = ((S.cfg && S.cfg.types) || []).filter(function (x) { return x.code === code; })[0];
    return (t && t.label) || code || 'Recon point';
  }
  function selected(g) { return g.items.filter(function (it) { return it.sel; }); }

  // ---------- read the picked files ----------
  function pick(input) {
    var files = [].slice.call(input.files || []); input.value = '';
    var jpgs = files.filter(function (f) { return /\.jpe?g$/i.test(f.name || '') || f.type === 'image/jpeg'; });
    var other = files.length - jpgs.length;
    if (jpgs.length > CONFIG.DRONE_MAX_BATCH) { A.toast('Reading the first ' + CONFIG.DRONE_MAX_BATCH + ' photos. Pick the rest after.'); jpgs = jpgs.slice(0, CONFIG.DRONE_MAX_BATCH); }
    if (!jpgs.length) { A.toast(other ? 'Those are not JPEG photos (videos and RAW files are skipped).' : 'No photos picked.'); return; }
    var have = {}; D.items.forEach(function (it) { have[it.name + '|' + it.size] = 1; });
    jpgs = jpgs.filter(function (f) { return !have[f.name + '|' + f.size]; });
    D.scanning = true;
    var b = $('dPick'), done = 0;
    A.busy(b, true, 'Reading photos…');
    var next = function () {
      if (done >= jpgs.length) {
        D.scanning = false; A.busy(b, false);
        regroup();
        $('dStatus').textContent = D.items.length + ' photo' + (D.items.length === 1 ? '' : 's') + ' in ' + D.groups.length + ' group' + (D.groups.length === 1 ? '' : 's') +
          (other ? ' · ' + other + ' non-photo file' + (other === 1 ? '' : 's') + ' skipped' : '');
        render(); return;
      }
      var f = jpgs[done];
      $('dStatus').textContent = 'Reading ' + (done + 1) + ' / ' + jpgs.length + '…';
      f.slice(0, DroneMeta.HEAD_BYTES).arrayBuffer().then(function (buf) {
        var meta = DroneMeta.parse(new Uint8Array(buf), f.name);
        var thumb = meta.thumbOff ? URL.createObjectURL(f.slice(meta.thumbOff, meta.thumbOff + meta.thumbLen, 'image/jpeg')) : null;
        D.items.push({ id: 'p' + (++seq), file: f, name: f.name, size: f.size, meta: meta, thumb: thumb, sel: true });
      }).catch(function () {
        D.items.push({ id: 'p' + (++seq), file: f, name: f.name, size: f.size, meta: { placement: 'none', lat: null, lon: null }, thumb: null, sel: true });
      }).then(function () { done++; next(); });
    };
    next();
  }

  function regroup() {
    D.groups = DroneMeta.group(D.items).map(function (items) {
      return { id: 'g_' + items[0].name + '_' + items.length, items: items };
    });
  }

  // ---------- render ----------
  function placementLine(items) {
    var c = { target: 0, drone: 0, gps: 0, none: 0 };
    items.forEach(function (it) { c[it.meta.placement || 'none']++; });
    var parts = [];
    if (c.target) parts.push(c.target + ' at the laser-rangefinder target');
    if (c.drone) parts.push(c.drone + ' at the drone');
    if (c.gps) parts.push(c.gps + ' at the photo GPS');
    if (c.none) parts.push(c.none + ' with no location');
    var model = (items.filter(function (it) { return it.meta.model; })[0] || { meta: {} }).meta.model;
    return '📍 ' + parts.join(' · ') + (model ? ' · ' + model : '');
  }

  function render() {
    if (!$ || !$('dGroups')) return;   // opened on #drone: tabs render before boot(); boot renders
    $('dClear').classList.toggle('hidden', !D.items.length);
    var html = D.groups.map(function (g, gi) {
      var st = D.state[g.id] || {}, sel = selected(g), c = DroneMeta.centroid(sel.length ? sel : g.items);
      var first = g.items[0].meta.taken, last = g.items[g.items.length - 1].meta.taken;
      var head = 'Group ' + (gi + 1) + ' · ' + g.items.length + ' photo' + (g.items.length === 1 ? '' : 's') +
        (first ? ' · ' + fmtDay(first) + ' ' + fmtTime(first) + (last && fmtTime(last) !== fmtTime(first) ? '–' + fmtTime(last) : '') : '');
      var thumbs = g.items.map(function (it) {
        return '<button type="button" class="dth' + (it.sel ? '' : ' off') + '" data-p="' + it.id + '" title="' + A.esc(it.name) + '">' +
          (it.thumb ? '<img src="' + it.thumb + '" alt="">' : '<span>' + A.esc(it.name.replace(/^DJI_\d{8}/, '').slice(0, 14)) + '</span>') + '</button>';
      }).join('');
      var body;
      if (st.filed) {
        body = '<div class="s green">✓ ' + A.esc(st.filed) + '</div>';
      } else if (st.skipped) {
        body = '<div class="s">Skipped. <button class="link" data-act="unskip" data-g="' + g.id + '">Undo</button></div>';
      } else {
        var acts = '';
        if (c) acts += '<button class="btn btn-ghost" type="button" data-act="nearby" data-g="' + g.id + '">Find nearby points</button>';
        acts += '<button class="btn btn-next" type="button" data-act="new" data-g="' + g.id + '">New point' + (c ? ' here' : '') + '</button>';
        acts += '<button class="link" type="button" data-act="skip" data-g="' + g.id + '">Skip</button>';
        body = '<div class="hint">Tap a photo to leave it out (' + sel.length + ' of ' + g.items.length + ' selected).</div>' +
          '<div class="dacts">' + acts + '</div>' + nearbyHtml(g);
      }
      return '<div class="dgroup" data-g="' + g.id + '"><div class="t">' + A.esc(head) + '</div>' +
        '<div class="hint">' + A.esc(placementLine(g.items)) + '</div>' +
        '<div class="dthumbs">' + thumbs + '</div>' + body + '</div>';
    }).join('');
    $('dGroups').innerHTML = html || '<div class="hint center">No photos yet.</div>';
  }

  function nearbyHtml(g) {
    var n = D.nearby[g.id];
    if (!n) return '';
    if (n.loading) return '<div class="hint">Looking for recon points…</div>';
    if (n.error) return '<div class="s red">' + A.esc(n.error) + '</div>';
    var count = selected(g).length;
    var rows = n.points.map(function (p, i) {
      var title = typeLabel(p.type) + (p.subtype ? ' — ' + p.subtype : '');
      var meta = p.dist_m + ' m away' + (p.reporter ? ' · ' + p.reporter : '') + (p.when ? ' · ' + fmtDay(p.when) + ' ' + fmtTime(p.when) : '');
      return '<div class="item"><div class="t">' + A.esc(title) + '</div><div>' + A.esc(meta) + '</div>' +
        (p.description ? '<div class="hint">' + A.esc(p.description) + '</div>' : '') +
        '<div class="acts"><button class="btn btn-ghost" type="button" data-act="attach" data-g="' + g.id + '" data-i="' + i + '">Attach ' + count + ' photo' + (count === 1 ? '' : 's') + ' here</button></div></div>';
    }).join('');
    var wider = n.radius < 500 ? '<button class="link" type="button" data-act="wider" data-g="' + g.id + '">Search wider (500 m)</button>' : '';
    return '<div class="sub-title">' + (n.points.length ? 'Recon points within ' + n.radius + ' m' : 'No recon points within ' + n.radius + ' m of these photos') + '</div>' +
      '<div class="dlist">' + rows + '</div>' + wider;
  }

  // ---------- actions ----------
  function groupById(id) { return D.groups.filter(function (g) { return g.id === id; })[0]; }

  function findNearby(g, radius, btn) {
    if (!S.incident) { A.toast('Pick the incident at the top first.'); return; }
    if (!navigator.onLine) { A.toast('Finding nearby points needs signal. You can still start a new point, or come back with signal.', 6000); return; }
    var sel = selected(g), c = DroneMeta.centroid(sel.length ? sel : g.items);
    if (!c) return;
    D.nearby[g.id] = { loading: true, radius: radius, points: [] };
    if (btn) A.busy(btn, true, 'Searching…');
    render();
    Promise.all([Outbox.pinFor(S.incident && S.incident.incident_id), Store.deviceId()]).then(function (a) {
      if (!a[0]) { A.askPin(); throw Object.assign(new Error('Enter the incident PIN first.'), { code: 'no_pin' }); }
      return Api.post('nearby', { pin: a[0], device: a[1], lat: c.lat, lon: c.lon, radius_m: radius, incident_id: S.incident.incident_id }, 30000);
    }).then(function (d) {
      D.nearby[g.id] = { radius: d.radius_m, points: d.points || [] };
      render();
    }, function (e) {
      if (e.code === 'pin_invalid') A.askPin(e.message);
      D.nearby[g.id] = { radius: radius, points: [], error: e.message || 'Could not search.' };
      render();
    });
  }

  /** Downscale the selected photos one at a time (a full frame decode each; two at once can kill an iPhone tab). */
  function prepare(items, btn) {
    var out = [], i = 0;
    return items.reduce(function (p, it) {
      return p.then(function () {
        i++; if (btn) btn.innerHTML = '<span class="spin"></span>Preparing ' + i + ' / ' + items.length + '…';
        return downscale(it.file).then(function (blob) {
          out.push({ blob: blob, name: it.name, meta: DroneMeta.keywords(it.meta, it.name, 'sd') });
        }, function () { A.toast('Could not read ' + it.name + '; left out.'); });
      });
    }, Promise.resolve()).then(function () { return out; });
  }
  function downscale(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, CONFIG.DRONE_EDGE / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        // drop the decoded frame now (clear onerror first: src='' fires an error event)
        URL.revokeObjectURL(url); img.onerror = null; img.src = '';
        cv.toBlob(function (b) { cv.width = cv.height = 0; b ? res(b) : rej(new Error('encode failed')); }, 'image/jpeg', CONFIG.DRONE_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode failed')); };
      img.src = url;
    });
  }

  function attach(g, i, btn) {
    var p = D.nearby[g.id] && D.nearby[g.id].points[i], sel = selected(g);
    if (!p || !sel.length) { A.toast('Select at least one photo.'); return; }
    var label = typeLabel(p.type) + (p.subtype ? ' — ' + p.subtype : '') + ' (' + p.dist_m + ' m)';
    A.busy(btn, true, 'Preparing…');
    prepare(sel, btn).then(function (photos) {
      if (!photos.length) throw new Error('No photo could be read.');
      return Outbox.enqueue({
        recon_id: A.uuid(), kind: 'dattach', incident: S.incident,
        fields: { target_recon_id: p.recon_id || '', target_oid: p.oid, target_label: label, reporter_name: A.lsGet('wri_recon_name') || '' }
      }, photos).then(function () { return photos.length; });
    }).then(function (n) {
      A.busy(btn, false);
      D.state[g.id] = { filed: n + ' photo' + (n === 1 ? '' : 's') + ' attached to ' + label + (navigator.onLine ? ' · uploading' : ' · uploads when there’s signal') };
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
      render();
    }, function (e) { A.busy(btn, false); A.toast('Could not save on this phone: ' + e.message, 8000); });
  }

  function newPoint(g, btn) {
    if (!S.incident) { A.toast('Pick the incident at the top first.'); return; }
    var sel = selected(g);
    if (!sel.length) { A.toast('Select at least one photo.'); return; }
    if (sel.length > CONFIG.DRONE_PER_POINT) A.toast('A point holds up to ' + CONFIG.DRONE_PER_POINT + ' photos: the first ' + CONFIG.DRONE_PER_POINT + ' are used. Leave some out, or attach the rest to the new point after.', 7000);
    var use = sel.slice(0, CONFIG.DRONE_PER_POINT), c = DroneMeta.centroid(use);
    A.busy(btn, true, 'Preparing…');
    prepare(use, btn).then(function (photos) {
      A.busy(btn, false);
      if (!photos.length) { A.toast('No photo could be read.'); return; }
      A.prefillFromDrone({ groupId: g.id, lat: c ? c.lat : null, lon: c ? c.lon : null, when: use[0].meta.taken, photos: photos });
      window.WRIForms.showView('recon');
      A.toast('Photos and location filled in. Pick the type and save the point.', 5000);
    });
  }

  function onClick(e) {
    var th = e.target.closest('.dth');
    if (th) {
      var it = D.items.filter(function (x) { return x.id === th.dataset.p; })[0];
      if (it) { it.sel = !it.sel; render(); }
      return;
    }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var g = groupById(b.dataset.g); if (!g) return;
    var act = b.dataset.act;
    if (act === 'nearby') findNearby(g, CONFIG.DRONE_RADIUS_M, b);
    else if (act === 'wider') findNearby(g, 500, b);
    else if (act === 'attach') attach(g, Number(b.dataset.i), b);
    else if (act === 'new') newPoint(g, b);
    else if (act === 'skip') { D.state[g.id] = { skipped: true }; render(); }
    else if (act === 'unskip') { delete D.state[g.id]; render(); }
  }

  function clearAll() {
    D.items.forEach(function (it) { if (it.thumb) URL.revokeObjectURL(it.thumb); });
    D.items = []; D.groups = []; D.nearby = {}; D.state = {};
    $('dStatus').textContent = ''; render();
  }

  function boot() {
    A = window.WRIApp; $ = A.$; S = A.S;
    if (!$('dPick')) return;
    $('dPick').addEventListener('click', function () { if (!D.scanning) $('dInput').click(); });
    $('dInput').addEventListener('change', function () { pick(this); });
    $('dGroups').addEventListener('click', onClick);
    $('dClear').addEventListener('click', function () {
      var b = this;
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to clear the list (saved uploads are kept)'; setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Clear list'; }, 4000); return; }
      b.dataset.armed = ''; b.textContent = 'Clear list'; clearAll();
    });
    window.addEventListener('recon:saved', function (e) {
      var id = e.detail && e.detail.drone_group;
      if (id) { D.state[id] = { filed: 'Saved as a new recon point' + (navigator.onLine ? ' · uploading' : ' · uploads when there’s signal') }; render(); }
    });
    window.addEventListener('incident:changed', function () { D.nearby = {}; render(); });
    render();
  }
  window.DroneUI = { render: function () { render(); } };
  document.addEventListener('DOMContentLoaded', boot);
})();
