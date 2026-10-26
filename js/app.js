/* WRI Recon (offline) — the form, the saved-points list and the upload triggers.
 *
 * Same five steps as the classic Recon page. "Save point" stores the point and
 * its photos on the phone (IndexedDB) and the outbox uploads them whenever
 * there's signal: on open, when the phone comes back online, when the app is
 * brought to the front, and every 30 s while it's open (iOS has no background
 * upload; Android also uploads in the background via Background Sync).
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var TOTAL = 5;
  var S = {
    step: 1, cfg: null, incident: null, lat: null, lon: null, acc: null,
    isWri: 'yes', cat: CONFIG.CATEGORIES[0], type: null, sub: null,
    photos: []   // [{blob, name, url}]
  };
  var map = null, marker = null;

  // ---------- small helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, ms) { var t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500); }
  function busy(btn, on, label) {   // WRI rule: every button shows it's working until the work answers
    if (on) { btn._label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + esc(label || 'Working…'); }
    else { btn.disabled = false; if (btn._label != null) btn.innerHTML = btn._label; }
  }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now() + '-' + Math.random().toString(16).slice(2)); }
  function localNow() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function iconFor(code) { return 'assets/obs/' + encodeURIComponent(code) + '.png'; }

  // ---------- config (cached on the phone) ----------
  function loadConfig() {
    return Store.kvGet('config').then(function (cached) {
      if (cached) applyConfig(cached);
      return Api.getConfig().then(function (fresh) {
        if (!cached || fresh.version !== cached.version || JSON.stringify(fresh.incidents) !== JSON.stringify(cached.incidents)) {
          return Store.kvSet('config', fresh).then(function () { applyConfig(fresh); });
        }
      }).catch(function () {
        if (!cached) {
          $('incidentHint').textContent = 'Open Recon once with signal to load the lists. You can still pick a location now.';
        }
      });
    });
  }

  function applyConfig(cfg) {
    S.cfg = cfg;
    buildIncidents();
    buildStaff();
    buildCats();
    buildTypes();
  }

  // ---------- incident ----------
  function wantedIncident() {
    var m = /[?&]incident=([^&#]+)/.exec(location.search);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    try {   // the phone's choice from the Field App incident gate (same origin)
      var c = JSON.parse(lsGet('wri_incident_choice') || 'null');
      if (c && c.id && c.expires > Date.now()) return String(c.id);
    } catch (e) {}
    return lsGet('wri_recon_incident') || '';
  }

  function buildIncidents() {
    var list = (S.cfg && S.cfg.incidents) || [], sel = $('incidentSel');
    var want = String(wantedIncident()).toLowerCase(), cur = S.incident && S.incident.incident_id;
    sel.innerHTML = '';
    if (!list.length) {
      sel.innerHTML = '<option value="">No open incident</option>';
      $('incidentHint').textContent = 'No incident is open. Points can only be saved to an open incident.';
      S.incident = null; return;
    }
    list.forEach(function (r) {
      var o = document.createElement('option'); o.value = r.incident_id;
      o.textContent = r.project_key + ' · ' + r.client_name + (r.is_primary && list.length > 1 ? ' (primary)' : '');
      sel.appendChild(o);
    });
    var pick = list.filter(function (r) { return cur && r.incident_id === cur; })[0]
      || list.filter(function (r) { return want && (r.incident_id.toLowerCase() === want || r.project_key.toLowerCase() === want); })[0]
      || list.filter(function (r) { return r.is_primary; })[0] || list[0];
    sel.value = pick.incident_id; setIncident(pick);
  }
  function setIncident(r) {
    S.incident = r ? { incident_id: r.incident_id, project_key: r.project_key, client_name: r.client_name, incident_name: r.incident_name || r.project_key } : null;
    window.dispatchEvent(new Event('incident:changed'));
    if (r) lsSet('wri_recon_incident', r.incident_id);
    $('incidentHint').textContent = r ? 'Files to ' + r.project_key + ' (' + r.client_name + ').' : '';
  }

  // ---------- location ----------
  function setLoc(lat, lon, acc, from) {
    S.lat = Number(lat); S.lon = Number(lon); S.acc = acc == null ? null : Math.round(acc);
    $('coords').textContent = S.lat.toFixed(6) + ', ' + S.lon.toFixed(6) + (S.acc != null ? '  ± ' + S.acc + ' m' : '');
    if (from !== 'typed') { $('lat').value = S.lat.toFixed(6); $('lon').value = S.lon.toFixed(6); }
    if (map) {
      var ll = [S.lat, S.lon];
      if (!marker) marker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: '#EC2329', fillOpacity: 1 }).addTo(map);
      else marker.setLatLng(ll);
      if (from !== 'map') map.setView(ll, Math.max(map.getZoom(), 15));
    }
  }
  function gps() {
    var b = $('gpsBtn');
    if (!navigator.geolocation) { toast('This phone has no GPS access. Type the coordinates.'); return; }
    busy(b, true, 'Getting location…');
    navigator.geolocation.getCurrentPosition(function (p) {
      busy(b, false); b.classList.add('ok'); b.textContent = 'Location captured ✓ (tap to refresh)';
      setLoc(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
    }, function (e) {
      busy(b, false); toast('No GPS fix (' + e.message + '). Step outside, try again, or type the coordinates.', 6000);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
  function typed() {
    var la = parseFloat($('lat').value), lo = parseFloat($('lon').value);
    if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) setLoc(la, lo, null, 'typed');
  }
  function initMap() {
    if (map || typeof L === 'undefined' || !navigator.onLine) return;
    try {
      var inc = S.cfg && S.cfg.incidents && S.cfg.incidents.filter(function (r) { return S.incident && r.incident_id === S.incident.incident_id; })[0];
      var c = (inc && inc.lat != null) ? [inc.lat, inc.lon] : [46.87, -113.99];
      map = L.map('map', { zoomControl: true, attributionControl: true }).setView(c, 13);
      L.tileLayer(CONFIG.TILE_URL, { maxZoom: 19, attribution: 'Esri, Maxar' }).addTo(map);
      map.on('click', function (e) { setLoc(e.latlng.lat, e.latlng.lng, null, 'map'); });
      $('mapMsg').classList.add('hidden');
      if (S.lat != null) setLoc(S.lat, S.lon, S.acc, 'restore');
    } catch (e) { map = null; }
  }

  // ---------- reporter ----------
  function buildStaff() {
    var sel = $('wriName'), keep = sel.value || lsGet('wri_recon_name') || '';
    sel.innerHTML = '<option value="">Select…</option>';
    ((S.cfg && S.cfg.staff) || []).forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    sel.insertAdjacentHTML('beforeend', '<option value="__other__">Other…</option>');
    if (keep) { sel.value = keep; if (sel.value !== keep) { sel.value = '__other__'; $('wriOther').value = keep; } }
    $('wriOtherBox').classList.toggle('hidden', sel.value !== '__other__');
  }
  function setWri(v) {
    S.isWri = v;
    [].forEach.call($('wriToggle').children, function (b) { b.classList.toggle('active', b.dataset.val === v); });
    $('wriBox').classList.toggle('hidden', v !== 'yes');
    $('extBox').classList.toggle('hidden', v === 'yes');
    if (S.type) { var t = typeObj(S.type); if (t && t.wri_only && v !== 'yes') { S.type = null; S.sub = null; } }
    buildTypes();
  }
  function reporterName() {
    if (S.isWri === 'yes') { var v = $('wriName').value; return v === '__other__' ? $('wriOther').value.trim() : v; }
    return $('extName').value.trim();
  }

  // ---------- type ----------
  function typeObj(code) { return ((S.cfg && S.cfg.types) || []).filter(function (t) { return t.code === code; })[0]; }
  function buildCats() {
    $('catTabs').innerHTML = CONFIG.CATEGORIES.map(function (c) {
      return '<button type="button" class="cat-tab' + (c === S.cat ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
  }
  function buildTypes() {
    var types = ((S.cfg && S.cfg.types) || []).filter(function (t) { return t.category === S.cat && !(t.wri_only && S.isWri !== 'yes'); });
    $('obsGrid').innerHTML = types.map(function (t) {
      return '<button type="button" class="obs-card' + (t.code === S.type ? ' sel' : '') + '" data-code="' + esc(t.code) + '">' +
        '<img src="' + iconFor(t.code) + '" alt="" onerror="this.style.visibility=\'hidden\'"><span>' + esc(t.label) + '</span></button>';
    }).join('') || '<div class="hint">Lists not loaded yet — open once with signal.</div>';
    var t = typeObj(S.type), subs = t && t.has_subtype ? ((S.cfg && S.cfg.subtypes) || []).filter(function (s) { return s.parent_code === t.code; }) : [];
    $('subBox').classList.toggle('hidden', !subs.length);
    $('subChips').innerHTML = subs.map(function (s) {
      return '<button type="button" class="chip' + (s.code === S.sub ? ' sel' : '') + '" data-code="' + esc(s.code) + '">' + esc(s.label) + '</button>';
    }).join('');
  }

  // ---------- photos ----------
  function downscale(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, CONFIG.PHOTO_EDGE / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not read the photo')); }, 'image/jpeg', CONFIG.PHOTO_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read the photo')); };
      img.src = url;
    });
  }
  function addPhotos(input) {
    var files = [].slice.call(input.files || []); input.value = '';
    var room = CONFIG.MAX_PHOTOS - S.photos.length;
    if (files.length > room) toast('Up to ' + CONFIG.MAX_PHOTOS + ' photos per point. Save another point for more.');
    files.slice(0, Math.max(0, room)).reduce(function (p, f) {
      return p.then(function () { return downscale(f); }).then(function (blob) {
        S.photos.push({ blob: blob, name: f.name || 'photo.jpg', url: URL.createObjectURL(blob) }); renderPhotos();
      }).catch(function (e) { toast(e.message); });
    }, Promise.resolve());
  }
  function renderPhotos() {
    $('photoCount').textContent = S.photos.length + ' / ' + CONFIG.MAX_PHOTOS + ' photos';
    $('photoGrid').innerHTML = S.photos.map(function (p, i) {
      return '<div class="ph"><img src="' + p.url + '" alt=""><button type="button" class="rm" data-i="' + i + '">×</button></div>';
    }).join('');
  }

  // ---------- steps ----------
  function check(step) {
    if (step === 1) {
      if (!S.incident) return 'Pick the incident (open Recon with signal once if the list is empty).';
      if (S.lat == null) return 'Capture a location: GPS, tap the map, or type lat/lon.';
    }
    if (step === 2 && !reporterName()) return 'Enter your name.';
    if (step === 3 && !S.type) return 'Pick what you observed.';
    return '';
  }
  function go(n) {
    S.step = n;
    [].forEach.call(document.querySelectorAll('.step'), function (s) { s.classList.toggle('active', Number(s.dataset.step) === n); });
    $('progressFill').style.width = (n / TOTAL * 100) + '%';
    $('backBtn').classList.toggle('hidden', n === 1);
    $('nextBtn').classList.toggle('hidden', n === TOTAL);
    $('saveBtn').classList.toggle('hidden', n !== TOTAL);
    if (n === 1) setTimeout(function () { initMap(); if (map) map.invalidateSize(); }, 50);
    if (n === TOTAL) renderReview();
    window.scrollTo(0, 0);
  }
  function renderReview() {
    var t = typeObj(S.type) || {}, row = function (k, v) { return v ? '<div class="r"><div class="k">' + esc(k) + '</div><div>' + esc(v) + '</div></div>' : ''; };
    $('review').innerHTML =
      row('Incident', S.incident ? S.incident.project_key + ' · ' + S.incident.client_name : '') +
      row('When', $('obsTime').value.replace('T', ' ')) +
      row('Reporter', reporterName() + (S.isWri === 'no' && $('extAff').value ? ' (' + $('extAff').value + ')' : '')) +
      row('Type', (t.label || S.type) + (S.sub ? ' — ' + S.sub : '')) +
      row('Description', $('desc').value) +
      row('Task force', $('tfName').value + ($('tfStatus').value ? ' (' + $('tfStatus').value + ')' : '')) +
      row('Location', S.lat != null ? S.lat.toFixed(6) + ', ' + S.lon.toFixed(6) + (S.acc != null ? ' ± ' + S.acc + ' m' : '') : '') +
      row('Photos', String(S.photos.length));
  }

  function save() {
    for (var i = 1; i < TOTAL; i++) { var m = check(i); if (m) { toast(m); go(i); return; } }
    var b = $('saveBtn'); busy(b, true, 'Saving…');
    var t = typeObj(S.type) || {};
    var when = $('obsTime').value ? new Date($('obsTime').value).getTime() : Date.now();
    var rec = {
      recon_id: uuid(),
      incident: S.incident,
      fields: {
        latitude: S.lat, longitude: S.lon, observation_epoch: when,
        is_wri: S.isWri, reporter_name: reporterName(),
        reporter_affiliation: S.isWri === 'no' ? $('extAff').value : '',
        affiliation_desc: S.isWri === 'no' ? $('affDesc').value.trim() : '',
        observation_category: t.category || S.cat, observation_type: S.type, observation_subtype: S.sub || '',
        description: $('desc').value.trim(), tf_name_raw: $('tfName').value.trim(), tf_status_raw: $('tfStatus').value
      }
    };
    if (S.isWri === 'yes') lsSet('wri_recon_name', reporterName());
    Outbox.enqueue(rec, S.photos.map(function (p) { return { blob: p.blob, name: p.name }; })).then(function () {
      busy(b, false);
      $('doneTitle').textContent = 'Saved on this phone';
      $('doneSub').textContent = navigator.onLine ? 'Uploading now…' : 'No signal: it uploads by itself when you’re back in coverage. Open Recon then.';
      $('doneOverlay').classList.remove('hidden');
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
    }, function (e) {
      busy(b, false); toast('Could not save on this phone: ' + e.message + '. Free up storage and try again.', 8000);
    });
  }
  function resetForm() {
    $('doneOverlay').classList.add('hidden');
    S.photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    S.photos = []; S.type = null; S.sub = null; S.lat = null; S.lon = null; S.acc = null;
    $('desc').value = ''; $('tfName').value = ''; $('tfStatus').value = ''; $('lat').value = ''; $('lon').value = '';
    $('coords').textContent = 'No location yet'; $('gpsBtn').textContent = 'Use My Location'; $('gpsBtn').classList.remove('ok');
    if (marker && map) { map.removeLayer(marker); marker = null; }
    $('obsTime').value = localNow();
    renderPhotos(); buildTypes(); go(1);
  }

  // ---------- PIN ----------
  function askPin(msg) {
    $('pinMsg').textContent = msg || 'Enter the incident PIN. Points upload with it.';
    $('pinOverlay').classList.remove('hidden'); $('pinInput').value = ''; setTimeout(function () { $('pinInput').focus(); }, 50);
  }
  function submitPin() {
    var pin = $('pinInput').value.trim(), b = $('pinBtn');
    if (!pin) return;
    if (!navigator.onLine) {   // can't check it now; it's checked on the first upload
      Outbox.setPin(pin); $('pinOverlay').classList.add('hidden'); toast('PIN saved. It’s checked when you’re back in signal.'); return;
    }
    busy(b, true, 'Checking…');
    Store.deviceId().then(function (device) { return Api.post('pin', { pin: pin, device: device }, 20000); }).then(function () {
      busy(b, false); $('pinOverlay').classList.add('hidden'); return Outbox.setPin(pin);
    }, function (e) {
      busy(b, false);
      if (e.code === 'pin_invalid' || e.code === 'pin_locked') { $('pinMsg').textContent = e.message; return; }
      Outbox.setPin(pin); $('pinOverlay').classList.add('hidden'); toast('Couldn’t check the PIN now; saved, checked on upload.');
    });
  }

  // ---------- saved list + banner ----------
  function refreshStatus() {
    return Outbox.summary().then(function (s) {
      var waiting = s.queued, bn = $('banner');
      $('savedCount').textContent = (waiting + s.needs_pin + s.failed) ? '(' + (waiting + s.needs_pin + s.failed) + ')' : '';
      bn.className = 'banner';
      if (s.needs_pin) { bn.classList.add('red'); bn.textContent = s.needs_pin + ' saved item(s) waiting for the incident PIN — tap to enter it'; bn.dataset.act = 'pin'; }
      else if (s.failed) { bn.classList.add('red'); bn.textContent = s.failed + ' saved item(s) need attention — tap to see'; bn.dataset.act = 'list'; }
      else if (waiting) {
        bn.classList.add('amber');
        bn.textContent = waiting + ' saved item(s)' + (s.photos_waiting ? ', ' + s.photos_waiting + ' photo(s)' : '') + ' waiting to upload' + (navigator.onLine ? ' — uploading…' : ' — no signal. Open this app when you’re back in coverage.');
        bn.dataset.act = 'list';
      } else { bn.classList.add('hidden'); }
      if (!$('savedOverlay').classList.contains('hidden')) renderSaved();
    });
  }
  function renderSaved() {
    Outbox.list().then(function (rs) {
      $('savedHint').textContent = rs.length ? 'Items stay here for a day after they upload.' : 'Nothing saved on this phone.';
      $('savedList').innerHTML = rs.map(function (r) {
        var t = typeObj(r.fields.observation_type), sent = r.photos.filter(function (p) { return p.status === 'sent'; }).length;
        var title = (!r.kind || r.kind === 'recon') ? ((t && t.label) || r.fields.observation_type) : recordTitle(r);
        var st, cls;
        if (r.status === 'sent') { cls = 'green'; st = 'Uploaded' + (r.photos_failed ? ' — ' + r.photos_failed + ' photo(s) could not upload' : '') + (r.project_name ? ' to ' + r.project_name : '') + (r.result && r.result.request_id ? ' as ' + r.result.request_id : ''); }
        else if (r.status === 'needs_pin') { cls = 'red'; st = 'Waiting for the incident PIN'; }
        else if (r.status === 'failed') { cls = 'red'; st = r.last_error || 'Could not upload'; }
        else {
          cls = 'amber';
          var wait = (r.next_try || 0) - Date.now();
          st = (r.oid ? 'Point uploaded · ' + sent + ' of ' + r.photo_count + ' photo' + (r.photo_count === 1 ? '' : 's') + ' sent' : 'Waiting to upload') +
            (r.last_error ? ' · last try: ' + r.last_error : '') +
            (wait > 5000 ? ' · next try in ' + (wait > 90000 ? Math.round(wait / 60000) + ' min' : Math.round(wait / 1000) + ' s') + ' (or tap Retry now)' : '');
        }
        var bad = (r.photos || []).filter(function (p) { return p.status === 'failed'; });
        if (bad.length) st += ' · ' + bad.length + ' photo' + (bad.length === 1 ? '' : 's') + ' failed' + (bad[0].error ? ': ' + bad[0].error : '');
        var acts = '';
        if (r.status !== 'sent') acts += '<button class="link" data-act="retry" data-id="' + r.recon_id + '">Retry now</button>';
        if (r.status === 'failed' && r.error_code === 'incident_unknown') acts += '<button class="link" data-act="reinc" data-id="' + r.recon_id + '">File to the selected incident</button>';
        if (r.status === 'sent' && r.photos_failed) acts += '<button class="link" data-act="retry" data-id="' + r.recon_id + '">Retry photos</button>';
        acts += '<button class="link" data-act="discard" data-id="' + r.recon_id + '">Discard</button>';
        return '<div class="item"><div class="t">' + esc(title) + ' · ' + esc(r.incident ? r.incident.project_key : '') + '</div>' +
          '<div>' + new Date(r.created_at).toLocaleString() + (r.photo_count ? ' · ' + r.photo_count + ' photo(s)' : '') + '</div>' +
          '<div class="s ' + cls + '">' + esc(st) + '</div><div class="acts">' + acts + '</div></div>';
      }).join('');
    });
  }
  function savedAction(e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var id = b.dataset.id, act = b.dataset.act;
    if (act === 'discard') {
      if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to discard — it is NOT uploaded'; setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Discard'; }, 4000); return; }
      Outbox.discard(id).then(renderSaved);
    } else if (act === 'retry') { busy(b, true, 'Sending…'); Outbox.retry(id).then(function () { renderSaved(); }); }
    else if (act === 'reinc') {
      if (!S.incident) { toast('Pick an incident on the first screen first.'); return; }
      busy(b, true, 'Sending…'); Outbox.retry(id, S.incident).then(renderSaved);
    }
  }

  function recordTitle(r) {
    var f = r.fields || {};
    if (r.kind === '214') return '214: ' + String(f.activity || '').slice(0, 60);
    if (r.kind === 'rr') return 'Request: ' + String(f.item || '').slice(0, 60);
    if (r.kind === 'hasp') return 'HASP sign-off: ' + (f.employeeName || '');
    if (r.kind === 'vessel') return 'Vessel ' + f.step + ': ' + (f.passenger_name || f.vessel || '');
    return r.kind;
  }

  // ---------- upload triggers ----------
  function kick() { if (navigator.onLine) Outbox.drain().then(refreshStatus); else refreshStatus(); }
  // signal back / app reopened: skip any backoff, try everything now
  function wakeKick() { if (navigator.onLine) Outbox.wake().then(kick); else refreshStatus(); }
  var hiddenAt = 0;

  // ---------- boot ----------
  function boot() {
    $('obsTime').value = localNow();
    $('extAff').innerHTML = '<option value="">Select…</option>' + CONFIG.AFFILIATIONS.map(function (a) { return '<option>' + esc(a) + '</option>'; }).join('');
    renderPhotos(); buildCats(); buildTypes(); go(1);

    $('incidentSel').addEventListener('change', function () {
      var r = ((S.cfg && S.cfg.incidents) || []).filter(function (x) { return x.incident_id === $('incidentSel').value; })[0]; setIncident(r);
    });
    $('gpsBtn').addEventListener('click', gps);
    $('lat').addEventListener('input', typed); $('lon').addEventListener('input', typed);
    $('wriToggle').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setWri(b.dataset.val); });
    $('wriName').addEventListener('change', function () { $('wriOtherBox').classList.toggle('hidden', this.value !== '__other__'); });
    $('extAff').addEventListener('change', function () { $('affDescBox').classList.toggle('hidden', !this.value || this.value === 'Private Citizen'); });
    $('catTabs').addEventListener('click', function (e) { var b = e.target.closest('.cat-tab'); if (b) { S.cat = b.dataset.cat; buildCats(); buildTypes(); } });
    $('obsGrid').addEventListener('click', function (e) { var b = e.target.closest('.obs-card'); if (b) { S.type = b.dataset.code; S.sub = null; buildTypes(); } });
    $('subChips').addEventListener('click', function (e) { var b = e.target.closest('.chip'); if (b) { S.sub = b.dataset.code; buildTypes(); } });
    $('camBtn').addEventListener('click', function () { $('camInput').click(); });
    $('galBtn').addEventListener('click', function () { $('galInput').click(); });
    $('camInput').addEventListener('change', function () { addPhotos(this); });
    $('galInput').addEventListener('change', function () { addPhotos(this); });
    $('photoGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.rm'); if (!b) return;
      var p = S.photos.splice(Number(b.dataset.i), 1)[0]; if (p) URL.revokeObjectURL(p.url); renderPhotos();
    });
    $('nextBtn').addEventListener('click', function () { var m = check(S.step); if (m) { toast(m); return; } go(S.step + 1); });
    $('backBtn').addEventListener('click', function () { go(Math.max(1, S.step - 1)); });
    $('saveBtn').addEventListener('click', save);
    $('newBtn').addEventListener('click', resetForm);
    $('pinBtn').addEventListener('click', submitPin);
    $('pinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPin(); });
    $('savedBtn').addEventListener('click', function () { $('savedOverlay').classList.remove('hidden'); renderSaved(); });
    $('savedClose').addEventListener('click', function () { $('savedOverlay').classList.add('hidden'); });
    $('savedList').addEventListener('click', savedAction);
    $('sendNowBtn').addEventListener('click', function () {
      var b = this; busy(b, true, 'Uploading…');
      Store.all('records').then(function (rs) {
        return Promise.all(rs.filter(function (r) { return r.status === 'queued'; }).map(function (r) { r.next_try = 0; return Store.put('records', r); }));
      }).then(function () { return Outbox.drain(); }).then(function () { busy(b, false); renderSaved(); refreshStatus(); });
    });
    $('banner').addEventListener('click', function () {
      if (this.dataset.act === 'pin') askPin('The PIN changed or is wrong. Enter the current incident PIN.');
      else { $('savedOverlay').classList.remove('hidden'); renderSaved(); }
    });

    // iOS: storage is only protected once the app is on the Home Screen
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (ios && !standalone && !lsGet('wri_recon_a2hs')) $('a2hsCard').classList.remove('hidden');
    $('a2hsDismiss').addEventListener('click', function () { lsSet('wri_recon_a2hs', '1'); $('a2hsCard').classList.add('hidden'); });
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

    window.addEventListener('outbox:changed', refreshStatus);
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'outbox:changed') refreshStatus(); });
    window.addEventListener('online', function () { initMap(); wakeKick(); });
    window.addEventListener('offline', refreshStatus);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 60000) wakeKick(); else kick();   // back after a while = a fresh open
    });
    window.addEventListener('focus', kick);
    setInterval(function () { if (document.visibilityState === 'visible') kick(); }, 30000);

    loadConfig().then(function () { return Store.kvGet('pin'); }).then(function (pin) {
      if (!pin) askPin();
      setTimeout(wakeKick, 800);
    });
    refreshStatus();
  }
  window.WRIApp = { S: S, $: $, esc: esc, toast: toast, busy: busy, uuid: uuid, localNow: localNow, lsGet: lsGet, lsSet: lsSet,
    refreshStatus: function () { return refreshStatus(); }, kick: function () { kick(); }, recordTitle: recordTitle,
    askPin: function (m) { askPin(m); }, invalidateMap: function () { if (map) setTimeout(function () { map.invalidateSize(); }, 50); } };
  document.addEventListener('DOMContentLoaded', boot);
})();
