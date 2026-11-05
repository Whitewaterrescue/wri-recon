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
    photos: [],   // [{blob, name, url, meta?}]
    maxPhotos: CONFIG.MAX_PHOTOS, droneGroup: null   // a point started from the Drone tab holds up to DRONE_PER_POINT
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
  // 2026-11-05 (batch 11): "Nov 5, 5:46 AM", the way the rest of the app shows a time
  function fmtWhen(v) {
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? String(v || '') : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  // 2026-11-05 (batch 11): the Field App check-in (same origin) names the person holding the phone
  function checkin() { try { var c = JSON.parse(lsGet('wri_checkin_state') || 'null'); return c && c.name ? c : null; } catch (e) { return null; } }
  function whoAmI() { var c = checkin(); return (c && String(c.name).trim()) || lsGet('wri_recon_name') || ''; }

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
    linkType();
    buildTypes();
  }

  // ---------- incident ----------
  function wantedIncident() {
    if (S.link && S.link.inc) return S.link.inc;   // #recon?type=…&inc=
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
    if (r) lsSet('wri_recon_incident_label', JSON.stringify({ id: r.incident_id, label: r.project_key + ' · ' + r.client_name }));
    $('incidentHint').textContent = r ? 'Files to ' + r.project_key + ' (' + r.client_name + ').' : '';
  }

  /**
   * 2026-11-04 (batch 7, Sam run 2): the Incident box was blank until the lists loaded. Show the crew's
   * pick right away: the Field App's choice (wri_incident_choice: id, key, name, client) or the label this
   * phone last showed for that id. The choice also stands in as the incident until the lists arrive, so an
   * entry can be saved on a first open with no signal (the server still refuses anything not open).
   */
  function showPendingIncident() {
    var sel = $('incidentSel');
    if (S.incident || sel.options.length) return;
    var want = String(wantedIncident() || ''), c = null, label = '';
    try { c = JSON.parse(lsGet('wri_incident_choice') || 'null'); } catch (e) {}
    if (c && c.id && c.expires > Date.now() && String(c.id) === want && c.key) {
      label = c.key + (c.client ? ' · ' + String(c.client).toUpperCase() : '');
      S.incident = { incident_id: String(c.id), project_key: String(c.key), client_name: String(c.client || '').toUpperCase(), incident_name: String(c.name || c.key) };
    } else {
      try { var l = JSON.parse(lsGet('wri_recon_incident_label') || 'null'); if (want && l && String(l.id) === want) label = l.label; } catch (e) {}
    }
    var o = document.createElement('option');
    o.value = S.incident ? S.incident.incident_id : ''; o.textContent = label ? label : 'Loading the incident…';
    sel.appendChild(o);
    $('incidentHint').textContent = label ? 'Files to ' + label + '. Loading the lists…' : 'Loading the incident list…';
    if (S.incident) window.dispatchEvent(new Event('incident:changed'));
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
  var POOR_GPS_M = 50;
  function gps() {
    var b = $('gpsBtn');
    if (!navigator.geolocation) { toast('This phone has no GPS access. Type the coordinates.'); return; }
    busy(b, true, 'Getting location…');
    navigator.geolocation.getCurrentPosition(function (p) {
      var poor = p.coords.accuracy > POOR_GPS_M;
      busy(b, false); b.classList.toggle('ok', !poor);
      b.textContent = poor ? 'Weak GPS fix (± ' + Math.round(p.coords.accuracy) + ' m): tap to try again' : 'Location captured ✓ (tap to refresh)';
      setLoc(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
      if (poor) toast('GPS is only good to ± ' + Math.round(p.coords.accuracy) + ' m. Step into the open and tap again, or tap the exact spot on the map.', 8000);
    }, function (e) {
      busy(b, false); toast('No GPS fix (' + e.message + '). Step outside, try again, or type the coordinates.', 6000);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: S.acc > POOR_GPS_M ? 0 : 10000 });   // after a weak fix, a fresh one, not the cached
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
  // 2026-11-05 (batch 11): the checked-in name first (it's the person holding the phone), then the last name used.
  // A name that isn't on the staff list goes in the Other box by itself; the tech never has to pick "Other…".
  function buildStaff(fresh) {
    var sel = $('wriName'), cur = fresh ? '' : sel.value === '__other__' ? $('wriOther').value.trim() : sel.value;
    var keep = cur || whoAmI();
    var staff = (S.cfg && S.cfg.staff) || [];
    sel.innerHTML = '<option value="">Select…</option>';
    staff.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    sel.insertAdjacentHTML('beforeend', '<option value="__other__">Other…</option>');
    if (keep) {
      var hit = staff.filter(function (n) { return String(n).toLowerCase() === String(keep).toLowerCase(); })[0];
      if (hit) { sel.value = hit; $('wriOther').value = ''; } else { sel.value = '__other__'; $('wriOther').value = keep; }
    }
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
    var room = S.maxPhotos - S.photos.length;
    if (files.length > room) toast('Up to ' + S.maxPhotos + ' photos per point. Save another point for more.');
    files.slice(0, Math.max(0, room)).reduce(function (p, f) {
      return p.then(function () { return downscale(f); }).then(function (blob) {
        S.photos.push({ blob: blob, name: f.name || 'photo.jpg', url: URL.createObjectURL(blob) }); renderPhotos();
      }).catch(function (e) { toast(e.message); });
    }, Promise.resolve());
  }
  function renderPhotos() {
    $('photoCount').textContent = S.photos.length + ' / ' + S.maxPhotos + ' photos';
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
    if (!S.timeSet) $('obsTime').value = localNow();   // untouched: keep it "now"
    saveDraft();
    [].forEach.call(document.querySelectorAll('.step'), function (s) { s.classList.toggle('active', Number(s.dataset.step) === n); });
    $('progressFill').style.width = (n / TOTAL * 100) + '%';
    $('backBtn').classList.toggle('hidden', n === 1);
    $('nextBtn').classList.toggle('hidden', n === TOTAL);
    $('saveBtn').classList.toggle('hidden', n !== TOTAL);
    $('saveBtn').textContent = URGENT[safetyKind()] ? 'Save + send alert' : 'Save point';
    if (n === 1) setTimeout(function () { initMap(); if (map) map.invalidateSize(); }, 50);
    if (n === TOTAL) renderReview();
    window.scrollTo(0, 0);
  }
  function renderReview() {
    var t = typeObj(S.type) || {}, sk = safetyKind(), row = function (k, v) { return v ? '<div class="r"><div class="k">' + esc(k) + '</div><div>' + esc(v) + '</div></div>' : ''; };
    $('review').innerHTML =
      row('Incident', S.incident ? S.incident.project_key + ' · ' + S.incident.client_name : '') +
      row('When', S.timeSet ? fmtWhen($('obsTime').value) : 'When you tap Save') +
      row('Reporter', reporterName() + (S.isWri === 'no' && $('extAff').value ? ' (' + $('extAff').value + ')' : '')) +
      row('Type', (t.label || S.type) + (S.sub ? ' — ' + S.sub : '')) +
      row('Description', $('desc').value) +
      row('Task force', $('tfName').value + ($('tfStatus').value ? ' (' + $('tfStatus').value + ')' : '')) +
      row('Location', S.lat != null ? S.lat.toFixed(6) + ', ' + S.lon.toFixed(6) + (S.acc != null ? ' ± ' + S.acc + ' m' + (S.acc > POOR_GPS_M ? ' (weak fix: check it on the map)' : '') : '') : '') +
      row('Photos', String(S.photos.length)) +
      (sk ? row('Also', URGENT[sk] ? 'Emails the Incident Commander and Safety Officer now and logs it to the Safety unit log as ' + SAFETY[sk].toLowerCase() + '.' +
          (SAFETY[S.type] ? ' Command staff signed up for ' + SAFETY[sk].toLowerCase() + ' alerts get a text.' : '')
        : 'Logs it to the Safety unit log. Command staff signed up for near miss alerts get a text.') : '');
  }

  function save() {
    for (var i = 1; i < TOTAL; i++) { var m = check(i); if (m) { toast(m); go(i); return; } }
    var b = $('saveBtn'); busy(b, true, 'Saving…');
    var t = typeObj(S.type) || {};
    var when = S.timeSet && $('obsTime').value ? new Date($('obsTime').value).getTime() : Date.now();
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
    var droneGroup = S.droneGroup, safety = safetyKind();
    Outbox.enqueue(rec, S.photos.map(function (p) { return { blob: p.blob, name: p.name, meta: p.meta || '' }; })).then(function () {
      lsSet(DRAFT_KEY, '');   // saved: nothing left to pick up
      // 2026-11-05 (batch 11): a Stop work / Injury / Near miss point also goes to the Safety 214 (forms-ui.js safetyFromRecon):
      // stop work + injury as the urgent alert (IC + Safety Officer emailed now), a near miss as a plain Safety unit-log entry
      if (safety && window.WRIForms && WRIForms.safetyFromRecon) {
        return WRIForms.safetyFromRecon(rec, safety).catch(function (e) { toast('The point is saved, but the Safety 214 could not be: ' + e.message + '. Radio the Safety Officer.', 10000); });
      }
    }).then(function () {
      busy(b, false);
      if (droneGroup) window.dispatchEvent(new CustomEvent('recon:saved', { detail: { recon_id: rec.recon_id, drone_group: droneGroup } }));
      showDone(rec.recon_id, safety, !!SAFETY[rec.fields.observation_type]);
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
    }, function (e) {
      busy(b, false); toast('Could not save on this phone: ' + e.message + '. Free up storage and try again.', 8000);
    });
  }
  var DRAFT_KEY = 'wri_recon_draft', DRAFT_MS = 12 * 3600 * 1000;
  var DRAFT_IDS = ['desc', 'tfName', 'tfStatus', 'extName', 'extAff', 'affDesc', 'obsTime'];
  function saveDraft() {
    if (!S.booted) return;
    var d = draftObj();
    var empty = d.lat == null && !d.type && !d.v.desc && !d.v.tfName;
    lsSet(DRAFT_KEY, empty ? '' : JSON.stringify(d));
  }
  function draftObj() {
    var d = { at: Date.now(), step: S.step, lat: S.lat, lon: S.lon, acc: S.acc, cat: S.cat, type: S.type, sub: S.sub, isWri: S.isWri, timeSet: !!S.timeSet,
              incident: S.incident ? S.incident.incident_id : '', v: {} };
    if (S.link) { d.link = S.link.type; d.linkFrom = S.link.from || ''; d.skipped = !!S.link.skipped; d.via3 = !!S.link.via3; }
    DRAFT_IDS.forEach(function (id) { d.v[id] = $(id).value; });
    return d;
  }
  function readDraft() { try { return JSON.parse(lsGet(DRAFT_KEY) || 'null'); } catch (e) { return null; } }
  function restoreDraft(d, photos) {
    if (d === undefined) d = readDraft();
    if (!d || Date.now() - d.at > DRAFT_MS || (d.incident && S.incident && d.incident !== S.incident.incident_id)) return false;
    DRAFT_IDS.forEach(function (id) { if (d.v[id] != null) $(id).value = d.v[id]; });
    S.timeSet = d.timeSet; if (d.isWri) setWri(d.isWri);
    if (d.cat) { S.cat = d.cat; buildCats(); }
    S.type = d.type || null; S.sub = d.sub || null;
    setLink(d.link ? { type: d.link, from: d.linkFrom || '', skipped: !!d.skipped, via3: !!d.via3 } : null);
    buildTypes();
    if (photos && photos.length) { S.photos = photos; renderPhotos(); }
    if (d.lat != null) setLoc(d.lat, d.lon, d.acc, 'restore');
    go(Math.min(d.step || 1, TOTAL));
    toast('Picked up your unsaved ' + (d.link ? SAFETY[d.link].toLowerCase() + ' report' : 'point') + ' where you left off' + (S.photos.length ? '' : ' (add the photos again)') + '.', 6000);
    return true;
  }
  function clearForm() {
    S.timeSet = false;
    S.photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    S.photos = []; S.type = null; S.sub = null; S.lat = null; S.lon = null; S.acc = null;
    S.maxPhotos = CONFIG.MAX_PHOTOS; S.droneGroup = null;
    $('desc').value = ''; $('tfName').value = ''; $('tfStatus').value = ''; $('lat').value = ''; $('lon').value = '';
    $('coords').textContent = 'No location yet'; $('gpsBtn').textContent = 'Use My Location'; $('gpsBtn').classList.remove('ok');
    if (marker && map) { map.removeLayer(marker); marker = null; }
    $('obsTime').value = localNow();
    renderPhotos();
  }
  function resetForm() {
    var from = S.link && S.link.from;
    endDone();
    lsSet(DRAFT_KEY, '');
    clearForm(); setLink(null); buildTypes(); go(1);
    lsSet(DRAFT_KEY, '');
    unpark();   // a point set aside for a safety report comes back
    // a report started from the 214 tab's Safety buttons goes back there
    if (from === '214' && window.WRIForms) WRIForms.showView('214');
  }

  // ---------- one-tap safety reports (2026-11-05, batch 11) ----------
  // #recon?type=near_miss|injury|stop_work[&inc=<incident id>] (Field App Forms buttons, the 214 Safety buttons):
  // WRI = yes, the checked-in name, Safety + the type picked, GPS started. Step 1 -> Next goes straight to the details.
  // A different unsaved point is set aside (wri_recon_draft_parked, photos kept in memory) and comes back after.
  var SAFETY = { near_miss: 'Near miss', injury: 'Injury', stop_work: 'Stop work' };
  var URGENT = { injury: 1, stop_work: 1 };   // these also send the IC + Safety Officer alert (the batch 7 214 path)
  var PARK_KEY = 'wri_recon_draft_parked', parkedPhotos = {};
  function parseLink(hash) {
    var m = /^#recon\?(.*)$/.exec(hash || '');
    if (!m) return null;
    var q = {};
    m[1].split('&').forEach(function (kv) {
      var p = kv.split('=');
      try { if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')).trim(); } catch (e) {}
    });
    var type = String(q.type || '').toLowerCase();
    return SAFETY[type] ? { type: type, inc: q.inc || q.incident || '' } : null;
  }
  // the point's own kind; a stop work report filed under another Safety type (an older list) still goes as stop work
  function safetyKind() {
    if (SAFETY[S.type]) return S.type;
    var t = typeObj(S.type) || {};
    return S.link && S.type && (t.category || S.cat) === 'Safety' ? S.link.type : '';
  }
  function linkTitle() { return S.link ? SAFETY[S.link.type] + ' report' : ''; }
  function setLink(l) {
    S.link = l || null;
    $('safetyLink').classList.toggle('hidden', !S.link);
    if (S.link) $('safetyLinkTitle').textContent = linkTitle();
    if (!$('steps').classList.contains('hidden')) $('viewTitle').textContent = linkTitle() || 'Recon';
    linkType();
  }
  // the type picked for the link, once the lists say it exists (stop_work is new: an older list may not have it)
  function linkType() {
    if (!S.link) return;
    var have = !S.cfg || !!typeObj(S.link.type);   // no lists yet: keep it, the server checks the type
    if (have && !S.type) S.type = S.link.type;
    if (!have && S.type === S.link.type) S.type = null;
    S.cat = 'Safety'; buildCats();
    $('safetyLinkHint').textContent = have ? 'Mark the spot (GPS is on its way), then Next: what happened and photos.'
      : SAFETY[S.link.type] + ' isn’t on this phone’s list yet: pick the closest Safety type on step 3. It still goes to command.';
    $('obsMissing').classList.toggle('hidden', have);
    $('obsMissing').textContent = have ? '' : SAFETY[S.link.type] + ' isn’t on the list yet: pick the closest Safety type below.';
  }
  function parks() { try { var a = JSON.parse(lsGet(PARK_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function park(d) {
    if (!d) return;
    var a = parks(); a.push(d); lsSet(PARK_KEY, JSON.stringify(a.slice(-5)));
    if (S.photos.length) { parkedPhotos[d.at] = S.photos; S.photos = []; }
  }
  function unpark() {
    var a = parks(), inc = S.incident && S.incident.incident_id;
    for (var i = a.length - 1; i >= 0; i--) {
      if (Date.now() - a[i].at > DRAFT_MS) { a.splice(i, 1); continue; }
      if (a[i].incident && inc && a[i].incident !== inc) continue;   // another incident's: stays set aside
      var d = a.splice(i, 1)[0];
      lsSet(PARK_KEY, JSON.stringify(a));
      var ph = parkedPhotos[d.at]; delete parkedPhotos[d.at];
      lsSet(DRAFT_KEY, JSON.stringify(d));
      if (restoreDraft(d, ph)) toast('Back to the ' + (d.link ? SAFETY[d.link].toLowerCase() + ' report' : 'point') + ' you were working on before.', 6000);
      return;
    }
    lsSet(PARK_KEY, JSON.stringify(a));
  }
  /** Open a safety report. opts: {from: '214', desc}. */
  function openSafety(type, opts) {
    opts = opts || {};
    if (!SAFETY[type]) return false;
    var justSaved = !!done;   // the finish card is up: the form holds the point just saved, not a draft
    endDone();
    if (S.booted && !justSaved) saveDraft();
    var d = justSaved ? null : readDraft();
    if (!d && !justSaved && S.photos.length) d = draftObj();   // only photos so far: still worth keeping
    if (d && d.link === type && Date.now() - d.at < DRAFT_MS && restoreDraft(d)) {   // the same report, opened again: carry on with it
      if (opts.from) S.link.from = opts.from;
      if (S.lat == null) gps();
      return true;
    }
    if (d) park(d);
    lsSet(DRAFT_KEY, '');
    clearForm();
    setWri('yes'); buildStaff(true);
    S.type = null; setLink({ type: type, from: opts.from || '', inc: opts.inc || '' });
    buildTypes();
    if (opts.desc) $('desc').value = opts.desc;
    go(1);
    if (d) toast('Your unsaved point is set aside. It comes back after this report.', 6000);
    gps();
    return true;
  }
  function next() {
    var m = check(S.step); if (m) { toast(m); return; }
    // a safety report skips what's already filled: reporter + type set = straight to the details (type missing = step 3)
    if (S.link && S.step === 1 && !check(2)) { S.link.skipped = true; S.link.via3 = !!check(3); go(S.link.via3 ? 3 : 4); return; }
    go(S.step + 1);
  }
  function back() {
    if (S.link && S.link.skipped && (S.step === 3 || (S.step === 4 && !S.link.via3))) { go(1); return; }
    go(Math.max(1, S.step - 1));
  }

  // ---------- after Save (2026-11-05, batch 11) ----------
  // Live status for the point: Submitted once it's up, or saved on the phone when there's no signal; then the form
  // clears itself (~2.5 s). Photos still uploading carry on in the background (My entries shows them).
  var DONE_MS = 2500, SLOW_MS = 10000, done = null;
  function showDone(id, safety, texts) {   // texts: the point's type is the safety type (the SMS app keys on it)
    endDone();
    done = { id: id, safety: safety, texts: texts, t0: Date.now() };
    done.slow = setTimeout(renderDone, SLOW_MS);
    $('doneOverlay').classList.remove('hidden');
    renderDone();
  }
  function endDone() {
    if (done) { clearTimeout(done.slow); clearTimeout(done.auto); }
    done = null; $('doneOverlay').classList.add('hidden');
  }
  function renderDone() {
    if (!done) return;
    var dn = done;
    Store.get('records', dn.id).then(function (r) {
      if (dn !== done) return;
      var st = !r ? 'gone' : (r.oid || r.status === 'sent') ? 'sent' : r.status === 'needs_pin' ? 'pin' : r.status === 'failed' ? 'failed'
        : (!navigator.onLine || r.last_error || Date.now() - dn.t0 >= SLOW_MS) ? 'queued' : 'sending';
      var L = dn.safety ? SAFETY[dn.safety].toLowerCase() : '', icon = '✅', title, sub = '', more = '';
      if (st === 'sent') {
        title = 'Submitted';
        if (dn.safety) sub = (URGENT[dn.safety] ? 'The Incident Commander and Safety Officer are being emailed. ' : 'It goes on the Safety unit log. ') +
          (dn.texts ? 'Command staff signed up for ' + L + ' alerts get a text within 5 minutes.' : '');
        if (r && r.photo_count && r.status !== 'sent') more = 'Photos keep uploading in the background (My entries shows them).';
      } else if (st === 'sending') {
        icon = '<span class="spin big-spin"></span>'; title = 'Uploading…'; sub = 'Saved on this phone.';
      } else if (st === 'failed') {
        icon = '⚠️'; title = 'Saved on this phone'; sub = 'It could not upload: ' + ((r && r.last_error) || 'error') + '. Open My entries to fix it.';
      } else {
        icon = '📱'; title = 'Saved on this phone';
        sub = st === 'pin' ? 'It uploads once the incident PIN is in.' : 'It uploads by itself when you’re back in coverage.';
        if (dn.safety) more = 'The ' + L + (URGENT[dn.safety] ? ' alert' + (dn.texts ? ' and texts go' : ' goes') : dn.texts ? ' texts go' : ' log entry goes') + ' out once it uploads. Radio your supervisor and the Safety Officer now.';
      }
      $('doneIcon').innerHTML = icon; $('doneTitle').textContent = title; $('doneSub').textContent = sub;
      $('doneMore').textContent = more; $('doneMore').classList.toggle('hidden', !more);
      $('doneOverlay').dataset.state = st;
      // a final answer: clear the form shortly (a failure waits for the tech to read it)
      if (st !== 'sending' && st !== 'failed' && !dn.auto) dn.auto = setTimeout(function () { if (dn === done) resetForm(); }, DONE_MS + (more ? 1500 : 0));
    }).catch(function () {});
  }

  // ---------- Field App Checklist ticks (2026-11-03) ----------
  // A ticked daily task is a 214 entry. The Checklist (/wri-field-app/panels/tasks, same origin) moves it into
  // this outbox itself when it can load our scripts; with no signal it leaves it in wri_214_pending and we take it here.
  function takeChecklistTicks() {
    var pend; try { pend = JSON.parse(localStorage.getItem('wri_214_pending') || '[]'); } catch (e) { pend = []; }
    if (!pend.length) return;
    pend.reduce(function (p, r) {
      return p.then(function () { return Outbox.enqueue(r, []); }).then(function () {
        var left; try { left = JSON.parse(localStorage.getItem('wri_214_pending') || '[]'); } catch (e) { left = []; }
        lsSet('wri_214_pending', JSON.stringify(left.filter(function (x) { return x.recon_id !== r.recon_id; })));
      });
    }, Promise.resolve()).catch(function () {});
  }

  // ---------- PIN ----------
  // Each open incident has its own Gateway PIN (2026-10-27): the phone keeps one per
  // incident, and the prompt names the incident it is for.
  var pinInc = null;   // {incident_id, project_key} the open prompt is for
  function askPin(msg, inc) {
    pinInc = inc || S.incident || null;
    var name = pinInc ? (pinInc.project_key || pinInc.incident_name || pinInc.incident_id) : '';
    $('pinMsg').textContent = (msg || 'Enter the incident PIN. Points upload with it.') + (name ? ' (' + name + ')' : '');
    $('pinOverlay').classList.remove('hidden'); $('pinInput').value = ''; setTimeout(function () { $('pinInput').focus(); }, 50);
  }
  // 2026-11-04 (batch 7, Casey): the prompt had no way out; entries keep waiting for the PIN on the phone
  function cancelPin() {
    $('pinOverlay').classList.add('hidden');
    toast('No PIN yet: your entries stay on this phone and upload once the PIN is in. Tap My entries to add it.', 6000);
  }
  function submitPin() {
    var pin = $('pinInput').value.trim(), b = $('pinBtn');
    if (!pin) return;
    var incId = pinInc && pinInc.incident_id ? String(pinInc.incident_id) : '';
    if (!navigator.onLine) {   // can't check it now; it's checked on the first upload
      Outbox.setPin(pin, incId); $('pinOverlay').classList.add('hidden'); toast('PIN saved. It’s checked when you’re back in signal.'); return;
    }
    busy(b, true, 'Checking…');
    Store.deviceId().then(function (device) { return Api.post('pin', { pin: pin, device: device, incident_id: incId }, 20000); }).then(function () {
      busy(b, false); $('pinOverlay').classList.add('hidden'); return Outbox.setPin(pin, incId);
    }, function (e) {
      busy(b, false);
      if (e.code === 'pin_invalid' || e.code === 'pin_locked') { $('pinMsg').textContent = e.message; return; }
      Outbox.setPin(pin, incId); $('pinOverlay').classList.add('hidden'); toast('Couldn’t check the PIN now; saved, checked on upload.');
    });
  }
  /** Ask for the picked incident's PIN when the phone has none for it yet. */
  function ensurePinForIncident() {
    if (!S.incident) return;
    Outbox.pinFor(S.incident.incident_id).then(function (pin) { if (!pin) askPin('Enter the incident PIN.'); });
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
    if (r.kind === 'dattach') return 'Drone photos → ' + (f.target_label || 'recon point');
    if (r.kind === 'drill') return ({ timeline: 'Timeline', notification: 'Notified', observation: 'Obs', hotwash: 'Hot wash' }[f.entry_kind] || 'Drill') +
      ': ' + String(f.item_label || f.note || '').slice(0, 60) + (f.status ? ' (' + f.status.replace('_', ' ') + ')' : '');
    if (r.kind === 'drilldel') return 'Delete: ' + String(f.label || '').slice(0, 60);
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
    $('nextBtn').addEventListener('click', next);
    $('backBtn').addEventListener('click', back);
    $('safetyLinkCancel').addEventListener('click', function () {   // not a safety report after all: a normal point, nothing typed is lost
      setLink(null); buildTypes(); saveDraft(); toast('Now a normal recon point. Pick the type on step 3.');
    });
    window.addEventListener('hashchange', function () {   // the Field App can point an open page at a safety report
      var l = parseLink(location.hash); if (!l) return;
      if (l.inc && S.cfg) { var r = (S.cfg.incidents || []).filter(function (x) { return x.incident_id === l.inc || x.project_key === l.inc; })[0]; if (r) { $('incidentSel').value = r.incident_id; setIncident(r); } }
      openSafety(l.type, { inc: l.inc }); if (window.WRIForms) WRIForms.showView('recon');
    });
    $('saveBtn').addEventListener('click', save);
    $('obsTime').addEventListener('change', function () { S.timeSet = true; saveDraft(); });
    $('steps').addEventListener('change', saveDraft);
    $('steps').addEventListener('click', function () { setTimeout(saveDraft, 0); });
    $('newBtn').addEventListener('click', resetForm);
    $('pinBtn').addEventListener('click', submitPin);
    $('pinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPin(); });
    $('pinCancel').addEventListener('click', cancelPin);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('pinOverlay').classList.contains('hidden')) cancelPin(); });
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
      if (this.dataset.act === 'pin') Outbox.needsPinIncident().then(function (inc) { askPin('The PIN changed or is wrong. Enter the current incident PIN.', inc); });
      else { $('savedOverlay').classList.remove('hidden'); renderSaved(); }
    });

    // iOS: storage is only protected once the app is on the Home Screen
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (ios && !standalone && !lsGet('wri_recon_a2hs')) $('a2hsCard').classList.remove('hidden');
    $('a2hsDismiss').addEventListener('click', function () { lsSet('wri_recon_a2hs', '1'); $('a2hsCard').classList.add('hidden'); });
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}

    window.addEventListener('outbox:changed', function () { refreshStatus(); renderDone(); });
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'outbox:changed') refreshStatus(); });
    window.addEventListener('online', function () { initMap(); wakeKick(); });
    window.addEventListener('offline', function () { refreshStatus(); renderDone(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 60000) wakeKick(); else kick();   // back after a while = a fresh open
    });
    window.addEventListener('focus', kick);
    setInterval(function () { if (document.visibilityState === 'visible') kick(); }, 30000);

    var link = parseLink(location.hash);   // read before forms-ui clears the hash
    if (link) S.link = { type: link.type, inc: link.inc };   // wantedIncident() follows &inc=
    showPendingIncident();
    buildStaff();   // the checked-in name shows before the lists load
    if (link) openSafety(link.type, { inc: link.inc });
    takeChecklistTicks();
    loadConfig().then(function () {
      S.booted = true;
      if (link) saveDraft();
      else if (!/[?&]embed=(214|hasp)/.test(location.search)) restoreDraft();   // 2026-11-05 (batch 11): no recon draft in the 214 / HASP frames
      ensurePinForIncident();
      window.addEventListener('incident:changed', ensurePinForIncident);
      setTimeout(wakeKick, 800);
    });
    refreshStatus();
  }
  /**
   * Start a new point from a group of drone photos (Drone tab): location, time and photos
   * filled in, then the crew picks the type and saves as usual. photos: [{blob, name, meta}]
   */
  function prefillFromDrone(o) {
    S.photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    S.maxPhotos = CONFIG.DRONE_PER_POINT; S.droneGroup = o.groupId; if (S.link) setLink(null);
    S.photos = o.photos.slice(0, S.maxPhotos).map(function (p) { return { blob: p.blob, name: p.name, meta: p.meta, url: URL.createObjectURL(p.blob) }; });
    S.lat = null; S.lon = null; S.acc = null;
    if (marker && map) { map.removeLayer(marker); marker = null; }
    if (o.lat != null) { setLoc(o.lat, o.lon, null, 'drone'); $('coords').textContent += '  (from the drone photos: tap the map to move it)'; }
    else { $('coords').textContent = 'No location in these photos: tap the map, use GPS or type it'; $('lat').value = ''; $('lon').value = ''; }
    if (o.when) { var d = new Date(o.when); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); $('obsTime').value = d.toISOString().slice(0, 16); S.timeSet = true; }
    renderPhotos(); go(1);
  }

  window.WRIApp = { S: S, $: $, esc: esc, prefillFromDrone: prefillFromDrone, toast: toast, busy: busy, uuid: uuid, localNow: localNow, lsGet: lsGet, lsSet: lsSet,
    openSafety: openSafety, linkTitle: linkTitle, checkin: checkin, SAFETY: SAFETY, URGENT: URGENT,
    refreshStatus: function () { return refreshStatus(); }, kick: function () { kick(); }, recordTitle: recordTitle,
    askPin: function (m, inc) { askPin(m, inc); }, invalidateMap: function () { if (map) setTimeout(function () { map.invalidateSize(); }, 50); } };
  document.addEventListener('DOMContentLoaded', boot);
})();
