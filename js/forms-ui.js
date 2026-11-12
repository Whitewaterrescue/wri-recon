/* WRI field app (offline) — the 214 Log, HASP, Vessel and Request tabs.
 *
 * Same rules as Recon: everything is saved on the phone first and the outbox
 * uploads it when there's signal (js/forms.js says where each kind goes).
 * Lists these tabs need offline (HASPs for the incident, vessels, names) are
 * cached on the phone whenever the app opens with signal.
 */
(function () {
  var A, $, S;
  var cfg = { hasp: null, vessel: null };
  var view = 'recon', trip = null, openHasp = null, sig = { drawing: false, has: false };
  // ?embed=214: the Field App's floating 214 button opens this page with only the 214 tab
  var EMBED = /[?&]embed=214(&|#|$)/.test(location.search);
  // &from=gateway: an outside responder on WRI Respond (G2 2026-11-10). Their own log only:
  // no unit-log picker, no "Add to unit log?" (it sent contractors to Operations). Stop work /
  // injury / near miss still go to the Safety unit log.
  var OUTSIDE = EMBED && /[?&]from=gateway(&|#|$)/.test(location.search);
  // &section=safety|logistics|…: a dashboard's 214 button (js/fab214-host.js) preselects its own unit log.
  // Used for this panel only: it is not kept as the person's choice unless they change it themselves.
  var SEC_HOST = EMBED && !OUTSIDE ? ((/[?&]section=(command|operations|planning|logistics|finance|safety)(&|#|$)/.exec(location.search) || [])[1] || '') : '';
  var secFromHost = false;
  // 2026-11-05 (batch 11): ?embed=hasp&hasp=<id>: the Field App's HASP page signs one plan here (js/hasp-embed.js)
  var EMBED_HASP = /[?&]embed=hasp(&|#|$)/.test(location.search);
  var TITLES = { recon: 'Recon', drone: 'Drone Photos', '214': 'ICS 214 Log', hasp: 'HASP Sign-off', vessel: 'Vessel Manifest', rr: 'Resource Request', drill: 'Drill Eval' };

  function staff() {
    var a = (S.cfg && S.cfg.staff) || [], b = (cfg.hasp && cfg.hasp.staff) || [], c = (cfg.vessel && cfg.vessel.staff) || [];
    var seen = {}, out = [];
    a.concat(b, c).forEach(function (n) { n = String(n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } });
    return out.sort();
  }
  // 2026-11-04 (batch 7, Sam run 2): the Field App check-in (same origin) names the person holding the phone
  function checkinName() {
    try { var c = JSON.parse(A.lsGet('wri_checkin_state') || 'null'); return c && c.name ? String(c.name).trim() : ''; } catch (e) { return ''; }
  }
  var notMe = false;   // "Not you?" tapped: the name stays empty until they pick one
  // R1 2026-11-12: the Gateway's checked-in name is for its 214 panel only. Field Forms is on the same
  // site as the Field App, so saving it as wri_recon_name made the next Field App user "PW-TEST Morgan".
  var GW_NAME = '';
  function fillNames(sel, otherBox, otherInput, withOther) {
    // 2026-11-05 (batch 11): the checked-in name first (the person holding the phone), then the last name used here
    var keep = sel.value || (OUTSIDE ? (notMe ? '' : GW_NAME) : ((notMe ? '' : checkinName()) || A.lsGet('wri_recon_name'))) || '';
    var names = staff(), lc = function (n) { return n.toLowerCase(); };
    // a name that isn't on the staff list (the check-in name, one typed under Other…) is its own choice, not "Other…"
    if (keep && keep !== '__other__' && withOther) {
      var hit = names.filter(function (n) { return lc(n) === lc(keep); })[0];
      if (hit) keep = hit; else names = names.concat([keep]);
    }
    sel.innerHTML = '<option value="">Select…</option>' + names.map(function (n) { return '<option>' + A.esc(n) + '</option>'; }).join('') +
      (withOther ? '<option value="__other__">Other…</option>' : '');
    if (keep) { sel.value = keep; if (sel.value !== keep && withOther) { sel.value = '__other__'; otherInput.value = keep; } }
    if (otherBox) otherBox.classList.toggle('hidden', sel.value !== '__other__');
  }
  function pickedName(sel, otherInput) { return sel.value === '__other__' ? otherInput.value.trim() : sel.value; }
  function needIncident() { if (!S.incident) { A.toast('Pick the incident at the top first.'); return false; } return true; }
  function save(rec, btn, okMsg, after) {
    A.busy(btn, true, 'Saving…');
    return Outbox.enqueue(rec, []).then(function () {
      A.busy(btn, false);
      if (okMsg) A.toast(okMsg + (navigator.onLine ? ' Uploading…' : ' No signal: it uploads when you’re back in coverage.'));
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
      if (after) after();
    }, function (e) { A.busy(btn, false); A.toast('Could not save on this phone: ' + e.message, 8000); });
  }
  function statusLine(r) {
    if (r.status === 'sent' && r.kind === '214') {   // a personal entry is only on your log (Jordan 2026-11-04 read "Logistics log")
      var sec = r.result && r.result.section, unit = r.fields && r.fields.also_unit;
      return '<span class="s green">Uploaded to your log' + (unit ? ' and the ' + (sec ? A.esc(sec) + ' ' : '') + 'unit log' : '') + '</span>';
    }
    if (r.status === 'sent') return '<span class="s green">Uploaded' + (r.result && r.result.request_id ? ' as ' + A.esc(r.result.request_id) : '') +
      (r.result && r.result.section ? ' to the ' + A.esc(r.result.section) + ' log' : '') + '</span>';
    if (r.status === 'needs_pin') return '<span class="s red">Waiting for the incident PIN</span>';
    if (r.status === 'failed') return '<span class="s red">' + A.esc(r.last_error || 'Could not upload') + '</span>';
    return '<span class="s amber">Waiting to upload' + (r.last_error ? ' (' + A.esc(r.last_error) + ')' : '') + '</span>';
  }
  var rrSent = null;   // request ids already uploaded when the list first drew (no toast for those)
  function sameDay(t) { return new Date(t).toDateString() === new Date().toDateString(); }
  function renderMine(kind, el) {
    Outbox.list().then(function (rs) {
      var all = rs.filter(function (r) { return r.kind === kind; }), mine = all, other = 0;
      if (kind === '214') {   // a shared phone: only the person logging now (Jordan 2026-11-04 saw Riley's notes)
        all = all.filter(function (r) { return sameDay(r.created_at); });   // "My entries today" (2026-11-04, batch 7)
        var me = pickedName($('l214Name'), $('l214Other')).toLowerCase();
        mine = all.filter(function (r) { return !me || String(r.fields && r.fields.person || '').toLowerCase() === me; });
        other = all.length - mine.length;
        $('l214MineTitle').textContent = 'My entries today' + (mine.length ? ' (' + mine.length + ')' : '');
      }
      if (kind === 'rr') {    // Riley 2026-11-04: the number never showed. Say it when it comes back.
        var sent = all.filter(function (r) { return r.status === 'sent' && r.result && r.result.request_id; });
        if (rrSent) sent.forEach(function (r) { if (!rrSent[r.recon_id]) { A.toast('Logistics has your request: ' + r.result.request_id + '.', 7000); setTimeout(function () { pollRr(true); }, 4000); } });
        rrSent = {}; sent.forEach(function (r) { rrSent[r.recon_id] = 1; });
      }
      mine = mine.slice(0, 15);
      el.innerHTML = (mine.length ? mine.map(function (r) {
        return '<div class="item"><div class="t">' + A.esc(A.recordTitle(r)) + '</div><div>' + new Date(r.created_at).toLocaleString() +
          ' · ' + A.esc(r.incident ? r.incident.project_key : '') + '</div><div>' + statusLine(r) + '</div>' +
          (r.kind === '214' && r.fields && r.fields.urgent ? alertLine(r) : '') +
          (r.kind === 'rr' && r.result && r.result.request_id ? rrLine(r.result.request_id) : '') + '</div>';
      }).join('') : '<div class="hint">' + (kind === '214' ? 'Nothing logged today yet.' : 'Nothing yet.') + '</div>') +
        (other ? '<div class="hint">' + other + ' note(s) from other people on this phone are not shown.</div>' : '');
    });
  }

  // ---------- tabs ----------
  function tabOn(v) { return !CONFIG.TABS || CONFIG.TABS.indexOf(v) >= 0; }
  function showView(v) {
    if (!TITLES[v] || !tabOn(v)) v = 'recon';
    view = v;
    [].forEach.call($('tabs').children, function (b) { b.classList.toggle('active', b.dataset.view === v); });
    [].forEach.call(document.querySelectorAll('.view'), function (m) { m.classList.toggle('hidden', m.dataset.view !== v); });
    document.querySelector('.nav').classList.toggle('hidden', v !== 'recon');
    $('progressBar').classList.toggle('hidden', v !== 'recon');
    $('viewTitle').textContent = (v === 'recon' && A.linkTitle()) || TITLES[v];   // "Near miss report" (batch 11)
    try { history.replaceState(null, '', location.pathname + location.search + (v === 'recon' ? '' : '#' + v)); } catch (e) {}
    if (v === 'recon') A.invalidateMap();
    render();
  }
  function render() {
    if (view === '214') {
      fillNames($('l214Name'), $('l214OtherBox'), $('l214Other'), true); renderWho(); renderMine('214', $('l214List'));
      if (!$('l214Pos').value.trim()) $('l214Pos').value = myPosition(pickedName($('l214Name'), $('l214Other')));
      if (!$('l214Act').value.trim()) $('l214Time').value = A.localNow();   // the panel can sit open for hours
      renderAlert();
    }
    if (view === 'rr') {
      if (!$('rrName').value) $('rrName').value = A.lsGet('wri_recon_name') || checkinName(); renderMine('rr', $('rrList')); pollRr();
      renderPinNote($('rrPin')); renderOpenReq(); loadOpenReq();   // 2026-11-06: PIN up front + open requests
    }
    if (view === '214') renderPinNote($('l214Pin'));
    if (view === 'hasp') renderHasp();
    if (view === 'vessel') renderVessel();
    if (view === 'drone' && window.DroneUI) window.DroneUI.render();
    if (view === 'drill' && window.DrillUI) window.DrillUI.render();
  }

  // ---------- cached lists ----------
  function loadCfg(kind, url) {
    return Store.kvGet('cfg_' + kind).then(function (c) {
      if (c) { cfg[kind] = c; render(); }
      if (!navigator.onLine) return;
      return fetch(url, { redirect: 'follow' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) { cfg[kind] = j.data; render(); return Store.kvSet('cfg_' + kind, j.data); }
      });
    }).catch(function () {});
  }

  // ---------- 214 ----------
  function save214() {
    if (!needIncident()) return;
    var who = pickedName($('l214Name'), $('l214Other')), act = $('l214Act').value.trim();
    if (!who) { A.markBad($('l214Name').value === '__other__' ? $('l214Other') : $('l214Name'), 'Pick your name.'); return A.toast('Pick your name.'); }
    if (!act) { A.markBad($('l214Act'), 'Write the activity.'); return A.toast('Write the activity.'); }
    var at = $('l214Time').value ? new Date($('l214Time').value).getTime() : Date.now();
    var pt = mPoint(); if (typeof pt === 'string') return A.toast(pt, 5000);
    write214(who, act, at, $('l214Save'), true, $('l214Unit').checked, null, '', pt);
  }

  // ---------- "Put this on the map" (2026-11-06, Cody: the 214 and recon were double duty) ----------
  // One 214 entry can also be a recon point. One save puts both in the outbox: the point as recon_id R (its
  // photos with it, to the Recon API) and then the 214 as map-R (Logistics offline_214). The Ops 201
  // "Pull from the field" shows the pair as one line. Location: GPS when the box opens; the map is for marking a
  // spot you aren't standing on (the boom across the river).
  var M = { on: false, touched: false, type: '', lat: null, lon: null, acc: null, photos: [], map: null, marker: null };
  function mHere(beforeId) { var b = $(beforeId); if (b && $('m214').nextElementSibling !== b) b.parentNode.insertBefore($('m214'), b); }
  function mTypes() {
    var types = ((S.cfg && S.cfg.types) || []).filter(function (t) { return t.category !== 'Safety'; }), cats = [];
    types.forEach(function (t) { if (cats.indexOf(t.category) < 0) cats.push(t.category); });
    $('m214Type').innerHTML = !types.length ? '<option value="">Lists not loaded yet: open once with signal</option>' :
      '<option value="">Pick what it is…</option>' + cats.map(function (c) {
        return '<optgroup label="' + A.esc(c) + '">' + types.filter(function (t) { return t.category === c; }).map(function (t) {
          return '<option value="' + A.esc(t.code) + '">' + A.esc(t.label) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    $('m214Type').value = M.type || '';
    if ($('m214Type').value !== (M.type || '')) M.type = '';   // a type this incident's list doesn't have
  }
  function mSet(on, type) {   // tick / untick; type: preset the recon type (undefined keeps the pick)
    M.on = !!on; $('m214On').checked = M.on;
    if (type !== undefined) M.type = type || '';
    $('m214Box').classList.toggle('hidden', !M.on);
    if (M.on) { mTypes(); if (M.lat == null && !mGps.busy) mGps(); }
  }
  function mGps() {
    var b = $('m214Gps');
    if (!navigator.geolocation) { A.toast('This phone has no GPS access. Mark the spot on the map.'); return; }
    mGps.busy = true; A.busy(b, true, 'Getting location…');
    navigator.geolocation.getCurrentPosition(function (p) {
      mGps.busy = false; A.busy(b, false);
      var poor = p.coords.accuracy > A.POOR_GPS_M;
      b.classList.toggle('ok', !poor);
      b.textContent = poor ? 'Weak GPS fix (± ' + Math.round(p.coords.accuracy) + ' m): tap to try again' : 'Location captured ✓ (tap to refresh)';
      mLoc(p.coords.latitude, p.coords.longitude, p.coords.accuracy, 'gps');
    }, function (e) {
      mGps.busy = false; A.busy(b, false);
      A.toast('No GPS fix (' + e.message + '). Step outside and try again, or mark the spot on the map.', 6000);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
  function mLoc(lat, lon, acc, from) {
    M.lat = Number(lat); M.lon = Number(lon); M.acc = acc == null ? null : Math.round(acc);
    $('m214Coords').textContent = M.lat.toFixed(6) + ', ' + M.lon.toFixed(6) + (M.acc != null ? '  ± ' + M.acc + ' m' : '  (marked on the map)');
    if (!M.map) return;
    var ll = [M.lat, M.lon];
    if (!M.marker) M.marker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 2, fillColor: '#EC2329', fillOpacity: 1 }).addTo(M.map);
    else M.marker.setLatLng(ll);
    if (from !== 'map') M.map.setView(ll, Math.max(M.map.getZoom(), 16));
  }
  function mMap() {
    if (typeof L === 'undefined' || !navigator.onLine) { A.toast('The map needs signal. GPS works without it.'); return; }
    $('m214MapWrap').classList.remove('hidden');
    if (!M.map) {
      var inc = S.cfg && S.cfg.incidents && S.cfg.incidents.filter(function (r) { return S.incident && r.incident_id === S.incident.incident_id; })[0];
      var c = M.lat != null ? [M.lat, M.lon] : (inc && inc.lat != null) ? [inc.lat, inc.lon] : [46.87, -113.99];
      M.map = L.map('m214Map', { zoomControl: true, attributionControl: true }).setView(c, 16);
      L.tileLayer(CONFIG.TILE_URL, { maxZoom: 19, attribution: 'Esri, Maxar' }).addTo(M.map);
      M.map.on('click', function (e) { mLoc(e.latlng.lat, e.latlng.lng, null, 'map'); });
      if (M.lat != null) mLoc(M.lat, M.lon, M.acc, 'restore');
    }
    setTimeout(function () { M.map.invalidateSize(); }, 50);
    A.toast('Tap the spot on the map.');
  }
  function mPhotos(input) {
    var files = [].slice.call(input.files || []); input.value = '';
    var room = CONFIG.MAX_PHOTOS - M.photos.length;
    if (files.length > room) A.toast('Up to ' + CONFIG.MAX_PHOTOS + ' photos per point.');
    files.slice(0, Math.max(0, room)).reduce(function (p, f) {
      return p.then(function () { return A.downscale(f); }).then(function (blob) {
        M.photos.push({ blob: blob, name: f.name || 'photo.jpg', url: URL.createObjectURL(blob) }); mRenderPhotos();
      }).catch(function (e) { A.toast(e.message); });
    }, Promise.resolve());
  }
  function mRenderPhotos() {
    $('m214Photos').innerHTML = M.photos.map(function (p, i) {
      return '<div class="ph"><img src="' + p.url + '" alt=""><button type="button" class="rm" data-i="' + i + '">×</button></div>';
    }).join('');
  }
  function mReset() {   // after a save: the next entry starts as a plain 214 at a new spot
    M.photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    M.photos = []; M.lat = M.lon = M.acc = null; M.touched = false;
    if (M.marker && M.map) { M.map.removeLayer(M.marker); M.marker = null; }
    $('m214Coords').textContent = 'No location yet'; $('m214Gps').textContent = 'Use My Location'; $('m214Gps').classList.remove('ok');
    $('m214MapWrap').classList.add('hidden');
    mRenderPhotos(); mSet(false, '');
  }
  // null = no point; a string = what's missing; else the point to save
  function mPoint() {
    if (!M.on) return null;
    if (!M.type) return 'Pick what it is for the map point, or untick “Put this on the map”.';
    if (M.lat == null) return mGps.busy ? 'Still getting your location. Try again in a moment, or mark the spot on the map.'
      : 'The map point needs a location: tap Use My Location or mark the spot on the map.';
    return { type: M.type, lat: M.lat, lon: M.lon, photos: M.photos.slice() };
  }
  function pointRec(pt, id, who, act, at) {
    var t = (A.typeObj && A.typeObj(pt.type)) || {};
    return { recon_id: id, incident: S.incident, fields: {
      latitude: pt.lat, longitude: pt.lon, observation_epoch: at, is_wri: 'yes', reporter_name: who,
      reporter_affiliation: '', affiliation_desc: '', observation_category: t.category || '', observation_type: pt.type,
      observation_subtype: '', description: act, tf_name_raw: '', tf_status_raw: '' } };
  }

  // The recon form's "Also log it in my 214" (2026-11-06): the point's line in the reporter's 214 and unit log,
  // id map-<recon_id> like an entry made here. Safety types never come here (safetyFromRecon writes theirs).
  // R1 2026-11-12: a 214 line takes the point's time only when it is plausible (the last 7 days, not ahead of
  // now). A drone photo with an unset clock dated one 2025-12-13 on an incident logged 2026-11-11.
  function lineTime(t) {
    var n = Date.now();
    return t && t > n - 7 * 864e5 && t < n + 36e5 ? t : n;
  }
  function logFromRecon(rec, label) {
    var f = rec.fields || {}, who = String(f.reporter_name || '').trim(), desc = String(f.description || '').trim();
    if (!who) return Promise.resolve(null);
    var r = { recon_id: 'map-' + rec.recon_id, kind: '214', incident: rec.incident, hold_until: 0,
              fields: { person: who, position: myPosition(who), activity: label + (desc ? ': ' + desc : '') + ' (on map)',
                        at: lineTime(f.observation_epoch), also_unit: true, section: A.lsGet('wri_214_section') || '',
                        default_section: 'operations', recon_id: rec.recon_id } };
    return Outbox.enqueue(r, []).then(function () { if (view === '214') renderMine('214', $('l214List')); return r; });
  }
  // Where a unit-log entry lands. "Auto" = the person's section on the work chart, Operations when
  // they aren't on it (lgOffline214_ default_section). Riley and Jordan (2026-11-03/04 walkthroughs)
  // both had entries land on Logistics unseen, so it's picked at the top and said up front.
  // Urgent safety events (Stop work, Injury, Near miss) always go to the Safety unit log.
  var SEC_NAMES = { command: 'Command', operations: 'Operations', planning: 'Planning', logistics: 'Logistics', finance: 'Finance', safety: 'Safety' };
  function unitDest(urgent) {
    var s = urgent ? 'safety' : $('l214Sec').value;
    return s ? 'the ' + SEC_NAMES[s] + ' unit log' : 'your section’s unit log on the work chart (Operations if you aren’t on it)';
  }
  function renderDest() {
    $('l214Dest').textContent = 'Unit-log entries go to ' + unitDest() + '. Stop work, injuries and near misses always go to Safety.';
  }
  function renderWho() {   // shared phones: say whose log this is
    var who = pickedName($('l214Name'), $('l214Other'));
    $('l214Who').classList.toggle('hidden', !who);
    $('l214WhoTxt').innerHTML = 'Logging as <b>' + A.esc(who) + '</b>';
  }
  // urgent: '' or the alert kind (stop_work | injury | near_miss): the server alerts the IC + Safety Officer (2026-11-04, batch 7)
  // pt: "Put this on the map" (mPoint): the recon point saved first, then the 214 with linked = map-<its id>
  function write214(who, act, at, btn, clearAct, unit, done, urgent, pt, linked) {   // unit: also post to the unit log (default: my own 214A only)
    if (urgent) unit = true;
    if (pt && !urgent) {
      var pid = A.uuid();
      A.busy(btn, true, 'Saving…');
      return Outbox.enqueue(pointRec(pt, pid, who, act, at), pt.photos.map(function (p) { return { blob: p.blob, name: p.name, meta: '' }; }))
        .then(function () {
          A.busy(btn, false); mReset();
          write214(who, act + ' (on map)', at, btn, clearAct, unit, done, '', null, 'map-' + pid);
        }, function (e) { A.busy(btn, false); A.toast('Could not save on this phone: ' + e.message + '. Free up storage and try again.', 8000); });
    }
    var quiet = !unit && noAskToday(who);   // "Don't ask again today": personal entries go straight up
    var pos = $('l214Pos').value.trim();
    if (pos !== myPosition(who)) A.lsSet('wri_214_pos_at', String(Date.now()));   // typed over the check-in's: it wins from now on
    if (!OUTSIDE) A.lsSet('wri_recon_name', who);   // a Gateway person's name is never kept on the phone
    A.lsSet('wri_214_pos', pos); if (!secFromHost) A.lsSet('wri_214_section', $('l214Sec').value);
    // a personal entry waits on the phone while "Add to unit log?" is up (ASK_MS), then uploads
    var rec = { recon_id: linked || A.uuid(), kind: '214', incident: S.incident, hold_until: unit || quiet || OUTSIDE ? 0 : Date.now() + ASK_MS + 2000,
                fields: { person: who, position: $('l214Pos').value.trim(), activity: act, at: at, also_unit: !!unit,
                          section: urgent ? 'safety' : $('l214Sec').value, default_section: 'operations' } };
    if (urgent) rec.fields.urgent = urgent;
    if (linked) rec.fields.recon_id = linked.slice(4);
    var onMap = linked ? ' It’s on the map too.' : '';
    save(rec, btn, urgent ? null : unit ? '214 note saved to your log and ' + unitDest() + '.' + onMap : quiet ? 'Saved to your 214 log.' + onMap : null, function () {
        if (urgent) {
          trackAlert(rec, urgent); renderAlert();
          A.toast(navigator.onLine ? 'Sending the ' + URG_LABEL[urgent] + ' alert to the Incident Commander and Safety Officer. Still radio them.'
            : 'No signal: the ' + URG_LABEL[urgent] + ' alert goes out when signal returns. Radio your supervisor and the Safety Officer now.', 12000);
        }
        if (!unit && !quiet && !OUTSIDE) askUnit(rec.recon_id, act, who);
        if (clearAct) $('l214Act').value = '';
        $('l214Time').value = A.localNow(); renderMine('214', $('l214List'));
        $('l214Unit').checked = false; $('q214Unit').checked = false; $('l214Save').textContent = 'Save note';   // every entry starts personal
        if (done) done();
        if (EMBED && window.parent !== window) try { window.parent.postMessage({ type: 'wri-214', action: 'saved', activity: act }, location.origin); } catch (e) {}
      });
  }

  // After a personal 214: "Saved to your log. Add to unit log?" with a button.
  // Until it's answered (or ASK_MS passes) the entry is held on the phone, so
  // the button just flips also_unit before it uploads.
  var ASK_MS = 12000, ask = null;
  // "Just mine, don't ask again today" (2026-11-04, batch 7): per name, per day, on this phone
  function dayKey() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function noAskMap() { try { return JSON.parse(A.lsGet('wri_214_noask') || '{}') || {}; } catch (e) { return {}; } }
  function noAskToday(who) { return !!who && noAskMap()[String(who).toLowerCase()] === dayKey(); }
  function setNoAsk(who) {
    var m = noAskMap(), today = dayKey();
    Object.keys(m).forEach(function (k) { if (m[k] !== today) delete m[k]; });
    m[String(who).toLowerCase()] = today; A.lsSet('wri_214_noask', JSON.stringify(m));
  }
  function askUnit(id, act, who) {
    endAsk(false);
    ask = { id: id, who: who, timer: setTimeout(function () { endAsk(false); }, ASK_MS) };
    $('l214AskTxt').innerHTML = '<b>Saved to your 214 log.</b> Add “' + A.esc(act.length > 60 ? act.slice(0, 57) + '…' : act) +
      '” to your section’s unit log too?';
    $('l214AskYes').disabled = false; $('l214AskYes').textContent = 'Add to unit log';
    $('l214Ask').classList.remove('hidden');
  }
  function endAsk(toUnit) {   // toUnit: the button; otherwise "Just mine" / time out
    if (!ask) return;
    var a = ask; ask = null; clearTimeout(a.timer);
    if (!toUnit) { $('l214Ask').classList.add('hidden'); Outbox.release(a.id); return; }
    A.busy($('l214AskYes'), true, 'Adding…');
    Outbox.release(a.id, { also_unit: true }).then(function (ok) {
      A.busy($('l214AskYes'), false); $('l214Ask').classList.add('hidden');
      A.toast(ok ? 'Added to ' + unitDest() + ' too.' + (navigator.onLine ? ' Uploading…' : ' It uploads when you’re back in coverage.')
                 : 'It had already uploaded to your log only. Ask your unit leader to add it.', 6000);
      renderMine('214', $('l214List'));
    }, function (e) { A.busy($('l214AskYes'), false); $('l214Ask').classList.add('hidden'); A.toast('Could not change it: ' + e.message, 6000); });
  }

  // Quick log (2026-10-31, Cody): page 1 = four big red category buttons,
  // page 2 = that category's activities as colored pills, details, Log it.
  var Q_ICONS = {   // 24x24 stroke icons (Lucide shapes)
    truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    hardhat: '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v3"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><rect x="2" y="15" width="20" height="4" rx="1"/>',
    waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
    radio: '<path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/>'
  };
  var qCat = null, qPick = null;
  function qSvg(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (Q_ICONS[k] || '') + '</svg>'; }
  // urgent items (Stop work, Injury, Near miss) never wait on typing: details optional (Cody 2026-11-04, batch 7)
  function needsDetail(item) { return /\u2026$/.test(item[0]) && item[3] !== 'urgent'; }
  function buildQuick() {
    $('q214Cats').innerHTML = (CONFIG.QUICK_214 || []).map(function (g, i) {
      return '<button type="button" class="q-cat qc-' + A.esc(g.color || 'red') + '" data-i="' + i + '">' + qSvg(g.icon) + '<span>' + A.esc(g.group) + '</span></button>';
    }).join('');
  }
  function openCat(i) {
    var g = (CONFIG.QUICK_214 || [])[i]; if (!g) return;
    qCat = g; qPick = null;
    $('q214Head').className = 'q-head qc-' + (g.color || 'red');
    $('q214Head').innerHTML = qSvg(g.icon) + '<span>' + A.esc(g.group) + '</span>';
    $('q214Urgent').innerHTML = g.items.map(function (it, j) {
      return it[3] !== 'urgent' ? '' : '<button type="button" class="q-urg" data-j="' + j + '"><span class="q-ico">' + A.esc(it[1] || '') +
        '</span><span>' + A.esc(it[0].replace(/\u2026$/, '')) + '</span></button>';
    }).join('');
    if ($('q214Urgent').innerHTML && A.openSafety) $('q214Urgent').insertAdjacentHTML('beforeend',   // batch 11
      '<div class="hint">Each opens a quick report: mark the spot, say what happened. Stop work and Injury also alert the Incident Commander and Safety Officer.</div>');
    $('q214Pills').innerHTML = g.items.map(function (it, j) {
      return it[3] === 'urgent' ? '' : '<button type="button" class="q-pill q-' + A.esc(it[2] || 'info') + '" data-j="' + j + '"><span class="q-ico">' + A.esc(it[1] || '') +
        '</span><span>' + A.esc(it[0].replace(/\u2026$/, '')) + '</span></button>';
    }).join('');
    $('q214Det').value = '';
    mHere('q214Submit'); if (!M.touched) mSet(false, '');
    qSync();
    $('q214Home').classList.add('hidden'); $('q214Page').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function closeCat() {
    qCat = null; qPick = null;
    mHere('l214Save'); if (!M.touched) mSet(false, '');
    $('q214Page').classList.add('hidden'); $('q214Home').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function isUrgent(it) { return !!it && it[3] === 'urgent'; }
  function urgentKind(it) {   // config's 5th value; older configs: from the label
    if (!isUrgent(it)) return '';
    if (URG_LABEL[it[4]]) return it[4];
    var l = String(it[0]).toLowerCase();
    return /stop/.test(l) ? 'stop_work' : /injur/.test(l) ? 'injury' : 'near_miss';
  }
  var unitForced = false;
  function qSync() {   // pill highlight, details label, submit text
    [].forEach.call($('q214Pills').children, function (b) { b.classList.toggle('sel', qPick !== null && Number(b.dataset.j) === qPick); });
    [].forEach.call($('q214Urgent').children, function (b) { b.classList.toggle('sel', qPick !== null && Number(b.dataset.j) === qPick); });
    var it = qCat && qPick !== null ? qCat.items[qPick] : null, b = $('q214Submit'), u = $('q214Unit'), urg = isUrgent(it);
    if (urg) { if (!u.disabled) unitForced = !u.checked; u.checked = true; u.disabled = true; }   // urgent = unit log, always
    else if (u.disabled) { u.disabled = false; if (unitForced) u.checked = false; unitForced = false; }
    $('q214UnitHint').textContent = urg ? 'Goes to your own log and the Safety unit log.'
      : 'Saves to your own log (ICS 214A). Tick to also post it to ' + unitDest() + ' (ICS 214).';
    $('q214DetLbl').textContent = it && needsDetail(it) ? 'Details (needed)' : 'Details (optional)';
    b.disabled = !it;
    b.textContent = it ? 'Log it: ' + it[0].replace(/\u2026$/, '') + (urg ? ' (my log + Safety)' : u.checked ? ' (my log + unit log)' : '') + (M.on && !urg ? ' + map' : '') : 'Pick an activity';
  }
  function submitQuick() {
    if (!qCat || qPick === null) return;
    if (!needIncident()) return;
    var who = pickedName($('l214Name'), $('l214Other'));
    if (!who) { A.toast('Pick your name at the top first.'); window.scrollTo(0, 0); $('l214Name').focus(); return; }
    var it = qCat.items[qPick], label = it[0].replace(/\u2026$/, ''), det = $('q214Det').value.trim();
    if (needsDetail(it) && !det) { A.toast('\u201c' + label + '\u201d needs details. Type them in the Details box, then tap Log it.', 5000); $('q214Det').focus(); return; }
    var act = det ? label + ' \u2014 ' + det : label, kind = urgentKind(it);
    if (kind) return confirmUrgent(kind, function (btn) {   // the IC + Safety Officer get alerted: ask first
      var d = $('urgDet').value.trim();   // details are offered on the confirm, never required
      write214(who, d ? label + ' \u2014 ' + d : label, Date.now(), btn, false, true, function () { closeUrg(); closeCat(); }, kind);
    });
    var pt = mPoint(); if (typeof pt === 'string') return A.toast(pt, 5000);
    write214(who, act, Date.now(), $('q214Submit'), false, $('q214Unit').checked, closeCat, '', pt);
  }

  // ---------- Stop work / Injury / Near miss alerts (2026-11-04, batch 7) ----------
  // The 214 goes through the outbox as always (it survives no signal); the server sees `urgent` and
  // emails / texts the IC and Safety Officer (Logistics SafetyAlert.js). The phone keeps the alert ids
  // (localStorage wri_214_alerts) and asks offline_alert_status until someone acknowledges (30 min max).
  var URG_LABEL = { stop_work: 'STOP WORK', injury: 'INJURY', near_miss: 'NEAR MISS' };
  var ALERT_KEY = 'wri_214_alerts', ALERT_SHOW_MS = 2 * 3600000, ALERT_POLL_MS = 30 * 60000, urgRun = null, alertPolling = false;
  function confirmUrgent(kind, run) {
    urgRun = run;
    var L = URG_LABEL[kind];
    $('urgTitle').textContent = 'Send ' + L + ' alert?';
    $('urgMsg').innerHTML = 'This alerts the <b>Incident Commander</b> and the <b>Safety Officer(s)</b> on the work chart and the HASP (email, and a text where it is set up) and logs it to your log and the Safety unit log.' +
      (navigator.onLine ? '' : '<br><b>No signal now: the alert goes out when signal returns.</b>') + '<br>Still radio them.';
    $('urgSend').textContent = 'Send ' + L + ' alert';
    $('urgDet').value = $('q214Det').value.trim();
    $('urgOverlay').classList.remove('hidden');
  }
  function closeUrg() { urgRun = null; $('urgOverlay').classList.add('hidden'); }
  function alerts() { try { var a = JSON.parse(A.lsGet(ALERT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveAlerts(a) { A.lsSet(ALERT_KEY, JSON.stringify(a.filter(function (x) { return Date.now() - x.at < 24 * 3600000; }).slice(-10))); }
  function trackAlert(rec, kind) {
    var a = alerts(); a.push({ id: rec.recon_id, kind: kind, who: rec.fields.person, at: Date.now(), inc: rec.incident && rec.incident.incident_id });
    saveAlerts(a);
  }
  function alertOf(id) { return alerts().filter(function (x) { return x.id === id; })[0] || null; }
  function currentAlert() {
    var a = alerts().filter(function (x) { return !x.hidden && Date.now() - x.at < ALERT_SHOW_MS; });
    return a[a.length - 1] || null;
  }
  function nameList(list) {
    var n = (list || []).map(function (t) { return t.name + (t.position ? ' (' + t.position + ')' : ''); });
    return n.length <= 1 ? n.join('') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }
  function hhmm(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  var RADIO = ' Radio your supervisor and the Safety Officer now.';
  // 2026-11-06 (batch 13): the server's newest word on an alert: the last offline_alert_status answer, else the 214 upload's
  function alertRes(al, r) {
    var polled = al && al.res && al.res.state && al.res.state !== 'none' ? al.res : null;
    return polled || (r && r.status === 'sent' && r.result && r.result.alert) || null;
  }
  // Who the alert went to, one row each: {name, position, source, status, via[], failed[], ack_at}.
  // Logistics since batch 13 sends recipients[] (status sending | sent | failed | no_contact | acknowledged; source
  // work_chart | checkin | hasp | desk, joined with '+'). Older servers: sent_to[] (reached) + not_reached[] (not reached,
  // reason unknown: no email/phone on file, or the send failed).
  var UNREACHED = { failed: 1, no_contact: 1, unreached: 1 };
  function hasRecipients(res) { return !!(res && Array.isArray(res.recipients) && res.recipients.length); }
  function alertPeople(res) {
    var out = [];
    if (hasRecipients(res)) {
      res.recipients.forEach(function (x) {
        if (!x || !x.name || x.cc) return;
        var st = String(x.status || '').toLowerCase();
        st = x.acknowledged || st === 'acked' || st === 'acknowledged' ? 'acked' : UNREACHED[st] || st === 'sending' ? st : 'sent';
        out.push({ name: String(x.name), position: x.position || x.role || '', source: String(x.source || ''), status: st,
          via: Array.isArray(x.via) ? x.via : [], failed: Array.isArray(x.failed) ? x.failed : [], ack_at: x.ack_at || '' });
      });
      return out;
    }
    ((res && res.sent_to) || []).forEach(function (x) { out.push({ name: x.name, position: x.position || x.role || '', source: '', status: 'sent', via: x.via || [], failed: [] }); });
    ((res && res.not_reached) || []).forEach(function (x) { out.push({ name: x.name, position: x.position || x.role || '', source: '', status: 'unreached', via: [], failed: [] }); });
    return out;
  }
  function unreached(ppl) { return ppl.filter(function (x) { return UNREACHED[x.status]; }); }
  function reachedOrSending(ppl) { return ppl.filter(function (x) { return !UNREACHED[x.status]; }); }
  function ackList(al, res) {   // everyone who acknowledged: [{name, position, at}]
    if (res && Array.isArray(res.acknowledged_by) && res.acknowledged_by.length) return res.acknowledged_by.filter(function (x) { return x && x.name; });
    var p = alertPeople(res).filter(function (x) { return x.status === 'acked'; }).map(function (x) { return { name: x.name, position: x.position, at: x.ack_at }; });
    if (p.length) return p;
    var one = (al && al.ack) || (res && res.ack && res.ack.name ? res.ack : null);
    return one ? [one] : [];
  }
  function alertAck(al, res) { return ackList(al, res)[0] || null; }   // the first acknowledgement, or null
  // finished: everyone who could be reached acknowledged (an older server: the first acknowledgement)
  function allAcked(al, res) {
    if (!hasRecipients(res)) return !!alertAck(al, res);
    var reach = reachedOrSending(alertPeople(res));
    return !!reach.length && reach.every(function (x) { return x.status === 'acked'; });
  }
  function isDesk(p) { return /(^|\+)desk(\+|$)/.test(p.source || '') || /alert desk/i.test(p.position || ''); }
  function failLine(failed) {
    return failed.length ? '<div class="a-fail">Couldn’t reach ' + A.esc(nameList(failed)) + ' — radio or call them now.</div>' : '';
  }
  function chip(p) {
    var via = (p.via || []).join(' + '), bad = (p.failed || []).join(' + ');
    var t = p.status === 'acked' ? ['ok', 'Acknowledged' + (p.ack_at ? ' ' + hhmm(p.ack_at) : '')]
      : p.status === 'sent' ? [bad ? 'warn' : 'sent', 'Sent' + (via ? ' by ' + via : '') + (bad ? ' · ' + bad + ' failed' : '')]
      : p.status === 'sending' ? ['warn', 'Sending…']
      : p.status === 'failed' ? ['bad', 'Could not send' + (bad ? ' (' + bad + ')' : '')]
      : p.status === 'no_contact' ? ['bad', 'No email or phone'] : ['bad', 'Not reached'];
    return '<span class="a-chip c-' + t[0] + '">' + A.esc(t[1]) + '</span>';
  }
  function peopleList(res) {   // one line per person (newer servers only: older ones say less than the headline)
    if (!hasRecipients(res)) return '';
    return '<ul class="a-ppl">' + alertPeople(res).map(function (p) {
      var src = /(^|\+)hasp(\+|$)/.test(p.source) ? ' · from the HASP' : isDesk(p) ? ' · alert desk' : '';
      return '<li><span class="a-who">' + A.esc(p.name) + (p.position ? ' (' + A.esc(p.position) + ')' : '') +
        (src ? '<span class="a-src">' + A.esc(src) + '</span>' : '') + '</span>' + chip(p) + '</li>';
    }).join('') + '</ul>';
  }
  function ackText(acks) {
    return acks.map(function (k) { return k.name + (k.at ? ' at ' + hhmm(k.at) : ''); }).join(', ');
  }
  function alertState(al, r) {   // {cls, html, done}
    var res = alertRes(al, r), ppl = alertPeople(res), acks = ackList(al, res), failed = unreached(ppl);
    var late = !!r && Date.now() - (r.sent_at || al.at) > ALERT_POLL_MS;
    if (acks.length) {
      var all = allAcked(al, res);
      return { cls: failed.length ? 'warn' : 'ok', done: all || late, html: '<b>Acknowledged by ' + A.esc(ackText(acks)) + '.</b>' + peopleList(res) + failLine(failed) +
        (all || late ? '' : '<span class="spin"></span>Waiting for the others to acknowledge…') };
    }
    if (!r) return { cls: 'bad', done: true, html: '<b>This alert is no longer saved on the phone.</b>' + RADIO };
    if (r.status === 'needs_pin') return { cls: 'bad', html: '<b>Not sent yet: it is waiting for the incident PIN.</b>' + RADIO };
    if (r.status === 'failed') return { cls: 'bad', html: '<b>The alert could not be sent</b> (' + A.esc(r.last_error || 'error') + ').' + RADIO };
    if (r.status !== 'sent') return navigator.onLine && r.last_error !== 'No signal'
      ? { cls: 'warn', html: '<span class="spin"></span><b>Sending the alert…</b>' + RADIO }
      : { cls: 'bad', html: '<b>No signal: the alert goes out when signal returns.</b>' + RADIO };
    if (!res) return { cls: 'bad', done: true, html: '<b>Saved to the Safety unit log, but no alert went out</b> (the server is not updated yet).' + RADIO };
    var to = ppl.filter(function (x) { return x.status === 'sent'; });
    var sending = res.state === 'sending' || ppl.some(function (x) { return x.status === 'sending'; });
    if (!to.length && sending) return { cls: 'warn', html: '<span class="spin"></span><b>Sending the alert…</b>' + peopleList(res) + failLine(failed) + RADIO };
    if (!to.length) return { cls: 'bad', done: true, html: '<b>Nobody could be alerted.</b> ' + A.esc(res.error || '') + peopleList(res) + failLine(failed) + RADIO };
    // the fallback desk only: nobody on the work chart / HASP as IC or Safety Officer could be emailed or texted
    var deskOnly = !!res.fallback || to.every(isDesk);
    return { cls: deskOnly || failed.length ? 'bad' : 'warn', done: late, html: '<b>Alert sent to ' + A.esc(nameList(to)) + '.</b> ' +
      (deskOnly ? (failed.length ? 'Only the Safety alert desk got it.' : '<div class="a-fail">Nobody on the work chart as Incident Commander or Safety Officer ' +
        'could be emailed or texted, so only the Safety alert desk got it — radio or call the IC and Safety Officer now.</div>') : '') +
      peopleList(res) + failLine(failed) +
      (late ? 'No acknowledgement after 30 minutes.' : '<span class="spin"></span>Waiting for acknowledgement…') + ' Still radio them.' };
  }
  function alertLine(r) {   // the short version in "My entries today"
    var al = alertOf(r.recon_id), res = alertRes(al, r), acks = ackList(al, res);
    var ppl = alertPeople(res), to = ppl.filter(function (x) { return x.status === 'sent' || x.status === 'acked'; }), failed = unreached(ppl);
    var t = acks.length ? 'Alert acknowledged by ' + ackText(acks)
      : to.length ? 'Alert sent to ' + nameList(to) + ', not acknowledged yet'
      : r.status === 'sent' ? 'No alert went out: radio them' : 'Alert waiting to go out';
    if (failed.length) t += '. Couldn’t reach ' + nameList(failed) + ': radio or call them';
    return '<div class="s ' + (acks.length && !failed.length ? 'green' : 'red') + '">' + A.esc(t) + '</div>';
  }
  // The alert's live status for any screen (the recon Save screen uses it): {cls, html, done}, or null if it isn't tracked
  function alertView(id) {
    var al = alertOf(id);
    if (!al) return Promise.resolve(null);
    return Store.get('records', id).then(function (r) { var t = alertState(al, r); t.kind = al.kind; t.at = al.at; return t; });
  }
  function alertChanged(id) { try { window.dispatchEvent(new CustomEvent('alert:changed', { detail: { id: id } })); } catch (e) {} }
  function gotRes(id, d) {   // keep the newest offline_alert_status answer (who was reached, who failed, who acknowledged)
    if (!d || !d.state || d.state === 'none') return;
    var a = alerts(), hit = a.filter(function (x) { return x.id === id; })[0];
    if (!hit) return;
    var was = JSON.stringify(hit.res || null);
    hit.res = { state: d.state, fallback: !!d.fallback, error: d.error || '', sent_to: d.sent_to || [], not_reached: d.not_reached || [],
      recipients: Array.isArray(d.recipients) ? d.recipients : undefined, acknowledged_by: Array.isArray(d.acknowledged_by) ? d.acknowledged_by : undefined,
      ack: d.ack || null };
    if (allAcked(hit, hit.res)) hit.fin = true;   // everyone reachable has acknowledged: polling stops
    if (JSON.stringify(hit.res) === was) { if (hit.fin) saveAlerts(a); return; }
    saveAlerts(a); renderAlert(); alertChanged(id);
    if (view === '214') renderMine('214', $('l214List'));
  }
  function renderAlert() {
    var al = currentAlert(), box = $('l214Alert');
    if (!al) { box.classList.add('hidden'); return; }
    Store.get('records', al.id).then(function (r) {
      var t = alertState(al, r);
      box.className = 'alert214 a-' + t.cls;
      box.innerHTML = '<div class="a-t">' + A.esc(URG_LABEL[al.kind] || 'Safety alert') + ' · ' + hhmm(al.at) + '</div><div class="a-b">' + t.html + '</div>' +
        (t.done ? '<button type="button" class="btn btn-ghost a-hide" data-id="' + A.esc(al.id) + '">Hide</button>' : '');
    }).catch(function () {});
  }
  function gotAck(id, ack) {   // the first acknowledgement: kept + a toast (later ones show in the list)
    var a = alerts(), hit = a.filter(function (x) { return x.id === id; })[0];
    if (!hit || hit.ack) return;
    hit.ack = { name: ack.name, at: ack.at }; saveAlerts(a);
    A.toast('Acknowledged by ' + ack.name + (ack.at ? ' at ' + hhmm(ack.at) : '') + '.', 8000);
    renderAlert(); alertChanged(id); if (view === '214') renderMine('214', $('l214List'));
  }
  function markFin(id) {
    var a = alerts(), hit = a.filter(function (x) { return x.id === id; })[0];
    if (hit && !hit.fin) { hit.fin = true; saveAlerts(a); }
  }
  // still asking: not everyone reachable acknowledged yet (an alert kept before batch 13: until its first acknowledgement)
  function stillOpen(x) { return !x.fin && !(x.ack && !hasRecipients(x.res)) && Date.now() - x.at < ALERT_SHOW_MS; }
  function pollAlert() {   // gently: every 20 s while the app is open, until everyone acknowledged or 30 min
    if (alertPolling || !navigator.onLine || document.visibilityState === 'hidden') return;
    var al = alerts().filter(stillOpen).pop();
    if (!al) return;
    alertPolling = true;
    Store.get('records', al.id).then(function (r) {
      if (!r || r.status !== 'sent') return;
      var res = alertRes(al, r);
      if (!res) return;
      var k = alertAck(null, res);
      if (k) gotAck(al.id, k);
      if (allAcked(alertOf(al.id), res)) return markFin(al.id);
      // nobody reached and nothing still sending: there is nothing to acknowledge
      if (res.state !== 'sending' && !reachedOrSending(alertPeople(res)).length) return;
      if (Date.now() - (r.sent_at || al.at) > ALERT_POLL_MS) return;
      return Promise.all([Outbox.pinFor(al.inc), Store.deviceId()]).then(function (a) {
        if (!a[0]) return;
        return Api.post('offline_alert_status', { pin: a[0], device: a[1], id: al.id, incident_id: al.inc }, 20000, CONFIG.LOGISTICS_API)
          .then(function (d) {
            if (!d || !d.state || d.state === 'none') return;
            var ack = alertAck(null, d);
            if (ack) gotAck(al.id, ack);
            gotRes(al.id, d);
          });
      });
    }).catch(function () {}).then(function () { alertPolling = false; });
  }

  // ---------- safety recon reports (2026-11-05, batch 11) ----------
  // The 214 Safety buttons open a recon report (#recon?type=…): the point puts it on the map and the opt-in SMS app texts
  // command staff subscribed to that type. Once the point is saved, its Safety 214 goes too: Stop work and Injury as the
  // urgent alert above (the IC + Safety Officer emailed at once, with the recon description), a near miss as a plain
  // Safety unit-log entry ("Near miss: …"), which the Sit Stat / Board near-miss count reads from the activity text.
  function openSafetyRecon(it) {
    var kind = urgentKind(it);
    if (!kind || !A.openSafety) return false;
    var det = $('q214Det').value.trim();
    closeCat(); showView('recon');
    return A.openSafety(kind, { from: '214', desc: det });
  }
  var safetyDone = {};   // recon ids whose Safety 214 is already in the outbox (one per point, ever)
  function safetyFromRecon(rec, kind) {   // kind: stop_work | injury | near_miss (default: the point's type)
    var f = rec.fields || {};
    kind = kind || f.observation_type;
    if (!A.SAFETY[kind] || safetyDone[rec.recon_id]) return Promise.resolve(null);
    safetyDone[rec.recon_id] = 1;
    var urgent = A.URGENT[kind] ? kind : '', desc = String(f.description || '').trim();
    var act = urgent ? (kind === 'injury' ? 'Injury reported' : 'Stop work') + (desc ? ' — ' + desc : '') + ' (recon point)'
      : 'Near miss' + (desc ? ': ' + desc : '') + ' (recon point)';
    var who = String(f.reporter_name || '').trim();
    var r = { recon_id: A.uuid(), kind: '214', incident: rec.incident, hold_until: 0,
              fields: { person: who, position: myPosition(who), activity: act, at: lineTime(f.observation_epoch), also_unit: true,
                        section: 'safety', default_section: 'operations', recon_id: rec.recon_id } };
    if (urgent) r.fields.urgent = urgent;
    return Outbox.enqueue(r, []).then(function () {
      if (urgent) { trackAlert(r, urgent); renderAlert(); }
      if (view === '214') renderMine('214', $('l214List'));
      return r;
    }, function (e) { delete safetyDone[rec.recon_id]; throw e; });
  }
  // the ICS position for a 214: the check-in's, unless one was typed on the 214 after that check-in
  function myPosition(who) {
    var c = A.checkin(), saved = A.lsGet('wri_214_pos') || '', at = Number(A.lsGet('wri_214_pos_at') || 0);
    var cpos = c ? String(c.position || c.role || '').trim() : '';
    var same = !who || (c && String(c.name).trim().toLowerCase() === String(who).trim().toLowerCase());
    if (cpos && same && !(saved && at > (Date.parse(c.since) || 0))) return cpos;
    return saved;
  }

  // ---------- request status (2026-11-04, batch 7): what Logistics has done with my requests ----------
  var RR_KEY = 'wri_rr_status', rrPollAt = 0;
  function rrStatus() { try { return JSON.parse(A.lsGet(RR_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function rrLine(reqId) {
    var st = rrStatus()[reqId]; if (!st) return '';
    var bits = [];
    if (st.seen_at) bits.push('Logistics saw it at ' + hhmm(st.seen_at));
    bits.push(st.label);
    if (st.eta) bits.push('ETA ' + (/^\d{4}-\d\d-\d\dT/.test(st.eta) ? new Date(st.eta).toLocaleString() : st.eta));
    return '<div class="s ' + (st.status === 'rejected' ? 'red' : st.status === 'new' ? 'amber' : 'green') + '">' + A.esc(bits.join(' · ')) + '</div>';
  }
  function pollRr(force) {
    if (!navigator.onLine || (!force && Date.now() - rrPollAt < 60000)) return;
    Outbox.list().then(function (rs) {
      var byInc = {};
      rs.forEach(function (r) {
        if (r.kind !== 'rr' || r.status !== 'sent' || !r.result || !r.result.request_id || !r.incident) return;
        (byInc[r.incident.incident_id] = byInc[r.incident.incident_id] || []).push(r.result.request_id);
      });
      if (!Object.keys(byInc).length) return;
      rrPollAt = Date.now();
      return Store.deviceId().then(function (device) {
        return Promise.all(Object.keys(byInc).map(function (inc) {
          return Outbox.pinFor(inc).then(function (pin) {
            if (!pin) return;
            return Api.post('offline_rr_status', { pin: pin, device: device, incident_id: inc, request_ids: byInc[inc] }, 20000, CONFIG.LOGISTICS_API).then(function (d) {
              var m = rrStatus(), changed = false, got = (d && d.requests) || {};
              Object.keys(got).forEach(function (id) {
                var n = got[id], o = m[id];
                if (!o || o.status !== n.status || o.seen_at !== n.seen_at || o.eta !== n.eta) {
                  changed = true;
                  if (o && n.seen_at && !o.seen_at) A.toast('Logistics saw your request ' + id + ' at ' + hhmm(n.seen_at) + '.', 7000);
                  else if (o && o.status !== n.status) A.toast('Request ' + id + ': ' + n.label + '.', 7000);
                }
                n.t = Date.now(); m[id] = n;
              });
              Object.keys(m).forEach(function (k) { if (!(Date.now() - (m[k].t || 0) < 4 * 864e5)) delete m[k]; });
              A.lsSet(RR_KEY, JSON.stringify(m));
              if (changed && view === 'rr') renderMine('rr', $('rrList'));
            });
          });
        }));
      });
    }).catch(function () {});
  }

  // ---------- open requests on the incident (2026-11-06, batch 13 polish) ----------
  // Persona run: a crew ordered 200 ft of boom while REQ-0053 (300 ft boom to Sha-Ron, a day overdue, still "new")
  // sat on the board, because the request form showed nothing. The form now reads the incident's open 213-RR
  // requests (read-only: the same Resource_Requests table of the field view the Incident Board reads, with the
  // Field App's ArcGIS sign-in on this origin), shows the ones for the same item or delivery site as you type,
  // flags overdue ones, and asks once before a likely duplicate is saved. The last list is kept per incident for
  // no-signal use ("as of").
  var RR_DONE = ['received', 'cancelled', 'canceled', 'rejected', 'closed', 'complete', 'completed', 'demobilized'];
  var RR_STOP = { ft: 1, feet: 1, foot: 1, inch: 1, inches: 1, the: 1, and: 1, for: 1, with: 1, each: 1, need: 1, needs: 1, more: 1,
    some: 1, please: 1, pcs: 1, extra: 1, new: 1, qty: 1, site: 1, area: 1, div: 1, division: 1, near: 1, from: 1, at: 1 };
  var openReq = { inc: '', rows: null, at: 0, fetched: 0, err: '', layer: null, showAll: false }, dupAck = '', dupTimer = 0;
  function rrWords(t) {
    return String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3 && !RR_STOP[w] && !/^\d+$/.test(w); })
      .map(function (w) { return w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w; });
  }
  function shares(a, b) { var m = {}; a.forEach(function (w) { m[w] = 1; }); return b.some(function (w) { return m[w]; }); }
  /** The Field App's ArcGIS session on this origin (exb_auth), when it has a few minutes left. */
  function agolToken() {
    var raw = null;
    try { raw = localStorage.getItem('exb_auth') || sessionStorage.getItem('exb_auth'); } catch (e) { return ''; }
    try { var a = JSON.parse(raw || 'null'); if (!a || !a.token) return '';
      var exp = a.expires != null && a.expires !== '' ? new Date(a.expires).getTime() : NaN;
      return isFinite(exp) && exp - Date.now() < 120000 ? '' : String(a.token); } catch (e) { return ''; }
  }
  function agolPost(url, fields, ms) {
    var body = new URLSearchParams(); Object.keys(fields).forEach(function (k) { body.set(k, String(fields[k])); });
    var ac = typeof AbortController === 'function' ? new AbortController() : null, t = ac && setTimeout(function () { ac.abort(); }, ms || 20000);
    return fetch(url, { method: 'POST', body: body, signal: ac ? ac.signal : undefined }).then(function (r) { return r.json(); })
      .then(function (j) { if (t) clearTimeout(t); if (j && j.error) throw new Error(j.error.message || 'ArcGIS error'); return j; },
        function (e) { if (t) clearTimeout(t); throw e; });
  }
  function loadOpenReq(force) {
    if (!S.incident || !CONFIG.INCIDENT_OPS_VIEW) return Promise.resolve();
    var inc = String(S.incident.incident_id), key = 'rr_open_' + inc;
    var cached = openReq.inc === inc ? Promise.resolve() : (openReq = { inc: inc, rows: null, at: 0, fetched: 0, err: '', layer: openReq.layer, showAll: false },
      Store.kvGet(key).then(function (c) { if (c && openReq.inc === inc && !openReq.rows) { openReq.rows = c.rows || []; openReq.at = c.at || 0; renderOpenReq(); } }).catch(function () {}));
    return cached.then(function () {
      if (!navigator.onLine || (!force && Date.now() - openReq.fetched < 60000)) return renderOpenReq();
      var tok = agolToken();
      if (!tok) { openReq.err = 'signin'; return renderOpenReq(); }
      openReq.fetched = Date.now();
      var svc = CONFIG.INCIDENT_OPS_VIEW;
      var lid = openReq.layer != null ? Promise.resolve(openReq.layer) : agolPost(svc, { f: 'json', token: tok }).then(function (j) {
        var l = (j.layers || []).concat(j.tables || []).filter(function (x) { return x.name === 'Resource_Requests'; })[0];
        if (!l) throw new Error('no Resource_Requests table');
        return (openReq.layer = l.id);
      });
      return lid.then(function (id) {
        return agolPost(svc + '/' + id + '/query', { f: 'json', token: tok, returnGeometry: 'false', resultRecordCount: 500,
          where: "incident_id = '" + inc.replace(/'/g, "''") + "'",
          outFields: 'request_id,item,quantity,uom,deliver_to,request_status,requested_at,eta,notes,priority,requested_by', orderByFields: 'requested_at DESC' });
      }).then(function (j) {
        if (openReq.inc !== inc) return;
        openReq.rows = (j.features || []).map(function (f) { return f.attributes || {}; })
          .filter(function (r) { return RR_DONE.indexOf(String(r.request_status || '').toLowerCase()) < 0; });
        openReq.at = Date.now(); openReq.err = '';
        Store.kvSet(key, { rows: openReq.rows, at: openReq.at }).catch(function () {});
        renderOpenReq();
      }, function (e) { if (openReq.inc === inc) { openReq.err = 'fail'; renderOpenReq(); } });
    });
  }
  function reqNeededBy(r) { var m = /(?:^|\s)Needed by ([^.]{1,40})\./.exec(String(r.notes || '')); return m ? m[1].trim() : ''; }
  function reqOverdue(r) { var e = Number(r.eta); return e > 1e12 && e < Date.now(); }
  function shortTime(ms) { return new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function reqLine(r, why) {
    var st = String(r.request_status || 'new').replace(/_/g, ' '), late = reqOverdue(r);
    var age = Number(r.requested_at) > 1e12 ? Math.round((Date.now() - Number(r.requested_at)) / 3600e3) : 0;
    var bits = [r.request_id, r.deliver_to ? 'to ' + r.deliver_to : '', reqNeededBy(r) ? 'needed by ' + reqNeededBy(r) : '',
      r.eta && !late ? 'ETA ' + shortTime(Number(r.eta)) : '', r.requested_by ? 'by ' + r.requested_by : ''].filter(Boolean);
    return '<div class="rq' + (late ? ' rq-late' : '') + '"><div class="rq-t">' + (late ? '<span class="rq-badge">OVERDUE</span>' : '') +
      '<span class="rq-st">' + A.esc(st) + '</span> ' + A.esc((r.quantity ? r.quantity + ' ' + (r.uom || '') + ' ' : '') + (r.item || 'Request')) + '</div>' +
      '<div class="rq-m">' + A.esc(bits.join(' · ')) + '</div>' +
      (late ? '<div class="rq-late-t">ETA was ' + A.esc(shortTime(Number(r.eta))) + (st === 'new' && age >= 6 ? ', still new after ' + age + ' h' : '') + '. Ask Logistics before ordering again.</div>' : '') +
      (why ? '<div class="rq-why">' + A.esc(why) + '</div>' : '') + '</div>';
  }
  /** Open requests like the one being typed: same item words or same delivery site. */
  function dupMatches() {
    var iw = rrWords($('rrItem').value), sw = rrWords($('rrWhere').value);
    if (!openReq.rows || (!iw.length && !sw.length)) return [];
    return openReq.rows.map(function (r) {
      var item = iw.length && shares(iw, rrWords(r.item)), site = sw.length && shares(sw, rrWords(r.deliver_to));
      return item || site ? { r: r, why: item && site ? 'Same item, same delivery site' : item ? 'Same item' : 'Same delivery site', score: (item ? 2 : 0) + (site ? 1 : 0) } : null;
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score || (reqOverdue(b.r) - reqOverdue(a.r)); });
  }
  function renderOpenReq() {
    if (view !== 'rr') return;
    var sum = $('rrOpenSum'), all = $('rrOpenAll'), dup = $('rrDup');
    var rows = openReq.rows, asOf = openReq.at && Date.now() - openReq.at > 10 * 60000 ? ' (as of ' + hhmm(openReq.at) + ')' : '';
    if (!rows) {
      sum.textContent = openReq.err === 'signin' ? 'Open requests show here when the Field App is signed in to ArcGIS.'
        : openReq.err === 'fail' ? 'Couldn’t load the open requests. Check the Incident Board before ordering.'
        : navigator.onLine ? 'Checking open requests on this incident…' : 'No signal: open requests show when you’re back in coverage.';
      $('rrOpenBtn').classList.add('hidden'); all.classList.add('hidden'); dup.innerHTML = ''; dup.classList.add('hidden'); return;
    }
    var late = rows.filter(reqOverdue).length;
    sum.innerHTML = rows.length ? A.esc(rows.length + ' open request' + (rows.length === 1 ? '' : 's') + ' on this incident') +
      (late ? ' · <b class="rq-late-n">' + late + ' overdue</b>' : '') + A.esc(asOf) : A.esc('No open requests on this incident' + asOf + '.');
    $('rrOpenBtn').classList.toggle('hidden', !rows.length);
    $('rrOpenBtn').textContent = openReq.showAll ? 'Hide' : 'Show';
    all.classList.toggle('hidden', !openReq.showAll || !rows.length);
    if (openReq.showAll) all.innerHTML = rows.slice().sort(function (a, b) { return reqOverdue(b) - reqOverdue(a); }).map(function (r) { return reqLine(r); }).join('');
    var m = dupMatches();
    dup.classList.toggle('hidden', !m.length);
    dup.innerHTML = m.length ? '<div class="rq-head">Already open on this incident: check before you order again</div>' +
      m.slice(0, 4).map(function (x) { return reqLine(x.r, x.why); }).join('') + (m.length > 4 ? '<div class="hint">and ' + (m.length - 4) + ' more (tap Show above)</div>' : '') : '';
    if (dupAck && dupAck !== dupKey(m)) rrSaveLabel();   // the form changed: ask again for the new match
  }
  function dupKey(m) { return m.map(function (x) { return x.r.request_id; }).join(','); }

  // ---------- incident PIN up front (2026-11-06, batch 13 polish) ----------
  // Persona run: the Gateway PIN was asked only after the whole request was typed. A form tab now says so as it
  // opens when this phone has no PIN for the incident (a note + Enter PIN, nothing blocks typing); Save still asks.
  function renderPinNote(el) {
    if (!el) return;
    if (!S.incident) { el.classList.add('hidden'); return; }
    var inc = S.incident.incident_id;
    Outbox.pinFor(inc).then(function (pin) {
      if (!S.incident || S.incident.incident_id !== inc) return;
      el.classList.toggle('hidden', !!pin);
      if (!pin) $(el.id + 'Txt').textContent = 'No incident PIN on this phone for ' + (S.incident.project_key || 'this incident') +
        ' yet. You can fill this in now; it uploads once the PIN is entered.';
    });
  }
  function pinAfterSave() {
    if (!S.incident) return;
    var inc = S.incident;
    Outbox.pinFor(inc.incident_id).then(function (pin) { if (!pin) A.askPin('Enter the incident PIN so this can upload. It stays saved on the phone until then.', inc); });
  }

  // ---------- 213-RR ----------
  function saveRr() {
    if (!needIncident()) return;
    var item = $('rrItem').value.trim(), who = $('rrName').value.trim();
    if (!item) { A.markBad($('rrItem'), 'Describe what you need.'); $('rrItem').focus(); return A.toast('Describe what you need.'); }
    if (!who) { A.markBad($('rrName'), 'Enter your name.'); $('rrName').focus(); return A.toast('Enter your name.'); }
    // a likely duplicate of an open request: show it and ask once (a second tap sends)
    var m = dupMatches(), k = dupKey(m);
    if (m.length && dupAck !== k) {
      dupAck = k; renderOpenReq();
      $('rrDup').scrollIntoView({ block: 'center', behavior: 'smooth' });
      var b = $('rrSave'); b.textContent = 'Send anyway (not a duplicate)'; b.classList.add('rr-confirm');
      clearTimeout(dupTimer); dupTimer = setTimeout(rrSaveLabel, 15000);
      return A.toast(m[0].r.request_id + ' is already open for this' + (reqOverdue(m[0].r) ? ' and OVERDUE' : '') + '. If you still need more, tap Send anyway.', 7000);
    }
    var pr = (document.querySelector('#rrPri .active') || {}).dataset;
    A.lsSet('wri_recon_name', who); A.lsSet('wri_rr_pos', $('rrPos').value.trim());
    clearTimeout(dupTimer);
    save({ recon_id: A.uuid(), kind: 'rr', incident: S.incident, fields: {
        item: item, qty: $('rrQty').value.trim() || '1', uom: $('rrUom').value.trim() || 'EA', priority: (pr && pr.val) || 'R',
        delivery: $('rrWhere').value.trim(), arrival: $('rrWhen').value.trim(), notes: $('rrNotes').value.trim(),
        requester: who, position: $('rrPos').value.trim(), at: Date.now() } },
      $('rrSave'), 'Request saved. Logistics sees it on the Incident Board within about 5 minutes of uploading.', function () {
        ['rrItem', 'rrWhere', 'rrWhen', 'rrNotes'].forEach(function (id) { $(id).value = ''; }); $('rrQty').value = '1'; $('rrUom').value = 'EA';
        dupAck = ''; rrSaveLabel(); renderOpenReq();
        renderMine('rr', $('rrList'));
        pinAfterSave();   // the submit-time PIN check stays
      });
  }
  function rrSaveLabel() { var b = $('rrSave'); if (b.disabled) return; dupAck = ''; b.textContent = 'Save request'; b.classList.remove('rr-confirm'); }

  // ---------- HASP ----------
  function haspsForIncident() {
    var inc = S.incident && cfg.hasp && (cfg.hasp.incidents || []).filter(function (i) { return i.incident_id === S.incident.incident_id; })[0];
    return inc ? inc.hasps || [] : null;
  }
  function renderHasp() {
    if (openHasp) return;
    $('haspDetail').classList.add('hidden'); $('haspList').classList.remove('hidden');
    var list = haspsForIncident();
    $('haspHint').textContent = !cfg.hasp ? 'Open the app once with signal to load the HASPs.' :
      list === null ? 'No HASP list for this incident yet. Open the app with signal to refresh.' :
      !list.length ? 'No HASP has been written for this incident yet.' :
      'Pick the HASP to read and sign. Saved ' + new Date(cfg.hasp.as_of).toLocaleString() + '.';
    $('haspList').innerHTML = (list || []).map(function (h, i) {
      return '<button type="button" class="btn btn-ghost hasp-item" data-i="' + i + '"><b>' + A.esc(h.project_name || 'HASP') + '</b> · ' +
        A.esc(h.hasp_date || '') + '<br><span class="hint">Lead ' + A.esc(h.project_lead || '—') + ' · ' + (h.acked || []).length + ' signed</span></button>';
    }).join('');
  }
  function openHaspDetail(h) {
    openHasp = h;
    $('haspList').classList.add('hidden'); $('haspDetail').classList.remove('hidden'); $('haspHint').textContent = '';
    var rows = [['Project', h.project_name], ['Client', h.client_name], ['Location', h.location], ['Date', h.hasp_date],
      ['Project lead', h.project_lead], ['Safety officer', h.safety_officer], ['Weather', [h.temperature, h.weather_conditions].filter(Boolean).join(', ')],
      ['Hazards', String(h.hazard_types || '').split(',').join(', ')], ['PPE level', h.ppe_level], ['Hospital', [h.hospital_name, h.hospital_phone].filter(Boolean).join(' · ')],
      ['Muster point', h.emergency_meeting_location], ['Evacuation', h.evacuation_route], ['Response', h.response], ['Notes', h.hasp_notes]];
    $('haspBody').innerHTML = rows.filter(function (r) { return r[1]; }).map(function (r) {
      return '<div class="r"><div class="k">' + A.esc(r[0]) + '</div><div>' + A.esc(r[1]) + '</div></div>'; }).join('');
    $('haspBody').scrollTop = 0;
    $('haspAcked').textContent = (h.acked || []).length ? 'Already signed: ' + h.acked.join(', ') : 'Nobody has signed yet.';
    fillNames($('haspName'), $('haspOtherBox'), $('haspOther'), true);
    renderHaspWho();
    $('haspRead').checked = false; clearSig(); sizeSig();
  }
  // 2026-11-06 (batch 13, persona test): the sign-off only ever signed as the name already on the phone. Say who signs,
  // and "Not you?" clears it so the person holding the phone picks (or types) their own name first (the 214's pattern).
  function renderHaspWho() {
    var who = pickedName($('haspName'), $('haspOther'));
    $('haspWho').classList.toggle('hidden', !who);
    $('haspWhoTxt').innerHTML = 'Signing as <b>' + A.esc(who) + '</b>';
  }
  function haspNotMe() {
    notMe = true; A.lsSet('wri_recon_name', '');
    $('haspName').value = ''; $('haspOther').value = ''; $('haspOtherBox').classList.add('hidden');
    renderHaspWho(); $('haspName').focus();
    A.toast('Pick your name (or Other… to type it), then sign.', 5000);
  }
  function sizeSig() {
    var c = $('sigPad'), r = c.getBoundingClientRect();
    c.width = Math.max(300, Math.round(r.width * 2)); c.height = 300;
    var x = c.getContext('2d'); x.lineWidth = 5; x.lineCap = 'round'; x.strokeStyle = '#111';
  }
  function clearSig() { var c = $('sigPad'); c.getContext('2d').clearRect(0, 0, c.width, c.height); sig.has = false; }
  function sigPos(e) { var c = $('sigPad'), r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; }
  function saveHasp() {
    if (!needIncident() || !openHasp) return;
    var who = pickedName($('haspName'), $('haspOther'));
    if (!who) return A.toast('Pick your name.');
    if (!$('haspRead').checked) return A.toast('Confirm you have read the HASP.');
    if ((openHasp.acked || []).map(function (n) { return n.toLowerCase(); }).indexOf(who.toLowerCase()) >= 0) return A.toast(who + ' already signed this HASP.');
    A.lsSet('wri_recon_name', who);
    var h = openHasp;
    save({ recon_id: A.uuid(), kind: 'hasp', incident: S.incident, fields: {
        haspId: h.objectId, employeeName: who, signatureBase64: sig.has ? $('sigPad').toDataURL('image/png') : '', ack_time: Date.now() } },
      $('haspSave'), 'HASP sign-off saved.', function () {
        h.acked = (h.acked || []).concat([who]);
        Store.kvSet('cfg_hasp', cfg.hasp); openHasp = null; renderHasp();
      });
  }

  // ---------- Vessel ----------
  function tripFields(t) {
    return { trip_key: t.trip_key, vessel: t.vessel, project_key: t.incident.project_key,
             incident_name: t.incident.incident_name || t.incident.project_key, client: t.incident.client_name };
  }
  function vesselRec(t, step, extra) {
    return { recon_id: A.uuid(), kind: 'vessel', incident: t.incident, fields: Object.assign(tripFields(t), { step: step, at: Date.now() }, extra || {}) };
  }
  function saveTrip() { return Store.kvSet('vessel_trip', trip); }
  function renderVessel() {
    var v = (cfg.vessel && cfg.vessel.vessels) || [];
    if (!trip) {
      $('tripStart').classList.remove('hidden'); $('tripLive').classList.add('hidden');
      var keep = $('vVessel').value;
      $('vVessel').innerHTML = '<option value="">Select…</option>' + v.map(function (n) { return '<option>' + A.esc(n) + '</option>'; }).join('');
      if (keep) $('vVessel').value = keep;
      fillNames($('vOperator'), null, null, false); fillNames($('vTech'), null, null, false);
      if (!v.length) $('vVessel').innerHTML = '<option value="">Open once with signal to load vessels</option>';
      return;
    }
    $('tripStart').classList.add('hidden'); $('tripLive').classList.remove('hidden');
    $('tripHead').innerHTML = '<div class="r"><div class="k">Vessel</div><div>' + A.esc(trip.vessel) + '</div></div>' +
      '<div class="r"><div class="k">Operator</div><div>' + A.esc(trip.operator) + '</div></div>' +
      '<div class="r"><div class="k">Departed</div><div>' + new Date(trip.started).toLocaleTimeString() + (trip.ramp ? ' · ' + A.esc(trip.ramp) : '') + '</div></div>' +
      '<div class="r"><div class="k">Incident</div><div>' + A.esc(trip.incident.project_key) + '</div></div>';
    $('pNames').innerHTML = ((cfg.vessel && cfg.vessel.names) || []).map(function (n) { return '<option value="' + A.esc(n) + '">'; }).join('');
    $('aboardCount').textContent = trip.aboard.length;
    $('aboardList').innerHTML = trip.aboard.length ? trip.aboard.map(function (p, i) {
      return '<div class="aboard"><div class="n">' + A.esc(p.name) + '<div class="o">' + A.esc([p.org, p.task].filter(Boolean).join(' · ')) +
        ' · aboard ' + new Date(p.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div></div>' +
        '<button type="button" class="btn btn-ghost" data-i="' + i + '">Disembark</button></div>';
    }).join('') : '<div class="hint">Nobody aboard.</div>';
  }
  function startTrip() {
    if (!needIncident()) return;
    var vessel = $('vVessel').value, op = $('vOperator').value;
    if (!vessel) return A.toast('Pick the vessel.');
    if (!op) return A.toast('Pick the operator.');
    trip = { trip_key: A.uuid(), vessel: vessel, operator: op, technician: $('vTech').value, ramp: $('vRamp').value.trim(),
             lat: trip && trip.lat, lon: trip && trip.lon, plan: $('vPlan').value.trim(), started: Date.now(), aboard: [], incident: S.incident };
    var ll = $('vGps').dataset.ll ? JSON.parse($('vGps').dataset.ll) : null;
    var rec = vesselRec(trip, 'depart', { operator: op, technician: trip.technician, ramp: trip.ramp, plan: trip.plan,
      lat: ll ? ll[0] : '', lon: ll ? ll[1] : '' });
    rec.fields.at = trip.started;
    saveTrip().then(function () { save(rec, $('vStart'), 'Departure saved.', renderVessel); });
  }
  function board() {
    var name = $('pName').value.trim();
    if (!name) return A.toast('Enter the passenger’s name.');
    if (!$('pBrief').checked) return A.toast('Give the safety briefing first, then tick the box.');
    if (trip.aboard.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) return A.toast(name + ' is already aboard.');
    var p = { name: name, org: $('pOrg').value.trim(), task: $('pTask').value.trim(), at: Date.now() };
    trip.aboard.push(p);
    saveTrip().then(function () {
      save(vesselRec(trip, 'board', { passenger_name: p.name, organization: p.org, task_destination: p.task, safety_talk: 'Yes' }),
        $('pBoard'), name + ' boarded.', function () { $('pName').value = ''; $('pOrg').value = ''; $('pTask').value = ''; $('pBrief').checked = false; renderVessel(); });
    });
  }
  var disIdx = -1;
  function askDisembark(i) {
    disIdx = i; $('disTitle').textContent = 'Disembark ' + trip.aboard[i].name;
    setToggle('disInj', 'No'); $('disDesc').value = ''; $('disCapt').checked = false; $('disDescBox').classList.add('hidden');
    $('disOverlay').classList.remove('hidden');
  }
  function setToggle(id, val) { [].forEach.call($(id).children, function (b) { b.classList.toggle('active', b.dataset.val === val); }); }
  function disembark() {
    var p = trip.aboard[disIdx]; if (!p) return;
    var inj = (document.querySelector('#disInj .active') || {}).dataset.val || 'No';
    if (inj === 'Yes' && !$('disDesc').value.trim()) return A.toast('Describe the injury.');
    trip.aboard.splice(disIdx, 1);
    $('disOverlay').classList.add('hidden');
    saveTrip().then(function () {
      save(vesselRec(trip, 'disembark', { passenger_name: p.name, injured: inj, injury_description: $('disDesc').value.trim(),
        captain_notified: inj === 'Yes' ? ($('disCapt').checked ? 'Yes' : 'No') : '' }), $('disOk'), p.name + ' disembarked.', renderVessel);
    });
  }
  function returnTrip() {
    var b = $('vReturn');
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.textContent = trip.aboard.length ? 'Tap again: disembark all ' + trip.aboard.length + ' and return' : 'Tap again to confirm return';
      setTimeout(function () { b.dataset.armed = ''; b.textContent = 'Return to ramp'; }, 5000); return;
    }
    b.dataset.armed = '';
    A.busy(b, true, 'Saving…');
    var t = trip, chain = Promise.resolve();
    t.aboard.slice().forEach(function (p) {
      chain = chain.then(function () { return Outbox.enqueue(vesselRec(t, 'disembark', { passenger_name: p.name, injured: 'No' }), []); });
    });
    chain.then(function () { return Outbox.enqueue(vesselRec(t, 'return', { notes: $('vNotes').value.trim() }), []); })
      .then(function () { trip = null; $('vNotes').value = ''; return Store.kvSet('vessel_trip', null); })
      .then(function () {
        A.busy(b, false); b.textContent = 'Return to ramp';
        A.toast('Trip closed.' + (navigator.onLine ? ' Uploading…' : ' It uploads when you’re back in coverage.'));
        renderVessel(); Outbox.drain();
      }, function (e) { A.busy(b, false); A.toast('Could not save: ' + e.message); });
  }

  // ---------- boot ----------
  function boot() {
    A = window.WRIApp; $ = A.$; S = A.S;
    if (EMBED) {
      document.body.classList.add('embed'); CONFIG.TABS = ['214'];
      if (OUTSIDE) {
        document.body.classList.add('embed-outside');
        $('l214Sec').value = '';
        var hide = function (el) { if (el) el.style.display = 'none'; };
        hide($('l214Sec').closest('.field'));
        var lu = $('l214Unit').closest('label'); hide(lu); hide(lu && lu.nextElementSibling);
        hide($('q214Unit').closest('label')); hide($('q214UnitHint'));
      }
      var nm = /[?&]name=([^&#]+)/.exec(location.search);   // the Field App's checked-in name
      // the checked-in person is the one holding the phone: their name wins over the last user's (Jordan 2026-11-04)
      var nmVal = nm ? decodeURIComponent(nm[1].replace(/\+/g, ' ')).trim() : '';
      if (OUTSIDE) GW_NAME = nmVal;   // this panel only (R1 2026-11-12)
      else if (nmVal) A.lsSet('wri_recon_name', nmVal);
      window.addEventListener('message', function (e) {   // panel reopened: refresh the time and the list
        if (e.origin === location.origin && e.data && e.data.type === 'wri-214' && e.data.action === 'open') render();
      });
    }
    buildQuick();
    $('q214Cats').addEventListener('click', function (e) { var b = e.target.closest('.q-cat'); if (b) openCat(Number(b.dataset.i)); });
    var onPick = function (e) {
      var b = e.target.closest('.q-pill, .q-urg'); if (!b) return;
      var j = Number(b.dataset.j);
      if (b.classList.contains('q-urg') && openSafetyRecon(qCat.items[j])) return;   // batch 11: Stop work / Injury / Near miss = a recon report
      qPick = qPick === j ? null : j;
      var it = qPick !== null ? qCat.items[qPick] : null;
      // 2026-11-06: an item that is a place on the map ticks "Put this on the map" with its recon type (unless the crew set it)
      var mt = it && (CONFIG.QUICK_214_MAP || {})[it[0]];
      if (!M.touched) mSet(!!mt, mt || '');
      qSync();
      if (it && needsDetail(it) && !$('q214Det').value.trim()) {   // tell them before they tap Log it
        A.toast('“' + it[0].replace(/…$/, '') + '” needs details. Type them in the Details box, then tap Log it.', 5000);
        $('q214Det').scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    $('q214Pills').addEventListener('click', onPick);
    $('m214On').addEventListener('change', function () { M.touched = true; mSet(this.checked); qSync(); });
    $('m214Type').addEventListener('change', function () { M.type = this.value; });
    $('m214Gps').addEventListener('click', mGps);
    $('m214MapBtn').addEventListener('click', mMap);
    $('m214Cam').addEventListener('click', function () { $('m214CamIn').click(); });
    $('m214Gal').addEventListener('click', function () { $('m214GalIn').click(); });
    $('m214CamIn').addEventListener('change', function () { mPhotos(this); });
    $('m214GalIn').addEventListener('change', function () { mPhotos(this); });
    $('m214Photos').addEventListener('click', function (e) {
      var b = e.target.closest('.rm'); if (!b) return;
      var p = M.photos.splice(Number(b.dataset.i), 1)[0]; if (p) URL.revokeObjectURL(p.url); mRenderPhotos();
    });
    $('q214Urgent').addEventListener('click', onPick);
    $('l214AskYes').addEventListener('click', function () { endAsk(true); });
    $('l214AskNo').addEventListener('click', function () { endAsk(false); });
    $('l214AskOff').addEventListener('click', function () {
      var who = ask && ask.who; if (who) setNoAsk(who);
      endAsk(false);
      if (who) A.toast('OK: no more “Add to unit log?” today for ' + who + '. Tick “Also post to the unit log” when one should go there.', 7000);
    });
    $('urgSend').addEventListener('click', function () { if (urgRun) urgRun(this); });
    $('urgCancel').addEventListener('click', function () { closeUrg(); A.toast('Not sent.'); });
    $('l214Alert').addEventListener('click', function (e) {
      var b = e.target.closest('.a-hide'); if (!b) return;
      var a = alerts(); a.forEach(function (x) { if (x.id === b.dataset.id) x.hidden = true; }); saveAlerts(a); renderAlert();
    });
    setInterval(pollAlert, 20000);
    setInterval(function () { if (view === 'rr' && document.visibilityState === 'visible') pollRr(); }, 60000);
    window.addEventListener('online', function () { renderAlert(); setTimeout(pollAlert, 3000); });
    window.addEventListener('offline', renderAlert);
    $('q214Back').addEventListener('click', closeCat);
    $('q214Submit').addEventListener('click', submitQuick);
    $('q214Unit').addEventListener('change', qSync);   // the button says where the entry goes
    $('l214Unit').addEventListener('change', function () { $('l214Save').textContent = this.checked ? 'Save note to my log + unit log' : 'Save note'; });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) showView(b.dataset.view); });
    $('l214Time').value = A.localNow(); $('l214Sec').value = SEC_HOST || A.lsGet('wri_214_section') || ''; secFromHost = !!SEC_HOST; $('rrPos').value = A.lsGet('wri_rr_pos') || '';
    $('l214Pos').value = myPosition(checkinName());   // batch 11: the check-in position
    renderDest();
    $('l214Name').addEventListener('change', function () { $('l214OtherBox').classList.toggle('hidden', this.value !== '__other__'); renderWho(); renderMine('214', $('l214List')); });
    $('l214Other').addEventListener('change', function () { renderWho(); renderMine('214', $('l214List')); });
    $('l214Sec').addEventListener('change', function () { secFromHost = false; A.lsSet('wri_214_section', this.value); renderDest(); qSync(); });
    $('l214NotMe').addEventListener('click', function () {   // hand-off on a shared phone: pick the right name first
      notMe = true; A.lsSet('wri_recon_name', ''); $('l214Name').value = ''; $('l214Other').value = ''; $('l214OtherBox').classList.add('hidden');
      renderWho(); renderMine('214', $('l214List')); $('l214Name').focus();
    });
    $('l214Save').addEventListener('click', save214);
    $('rrPri').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setToggle('rrPri', b.dataset.val); });
    $('rrSave').addEventListener('click', saveRr);
    var dupLater = function () { clearTimeout(dupLater._t); dupLater._t = setTimeout(renderOpenReq, 350); };
    $('rrItem').addEventListener('input', dupLater); $('rrWhere').addEventListener('input', dupLater);
    $('rrOpenBtn').addEventListener('click', function () { openReq.showAll = !openReq.showAll; renderOpenReq(); });
    ['rrPinBtn', 'l214PinBtn'].forEach(function (id) { $(id).addEventListener('click', function () { A.askPin('Enter the incident PIN.'); }); });
    window.addEventListener('online', function () { if (view === 'rr') loadOpenReq(true); });
    setInterval(function () { if (view === 'rr' && document.visibilityState === 'visible') loadOpenReq(); }, 60000);
    $('haspList').addEventListener('click', function (e) { var b = e.target.closest('.hasp-item'); if (b) openHaspDetail(haspsForIncident()[Number(b.dataset.i)]); });
    $('haspBack').addEventListener('click', function () { openHasp = null; renderHasp(); });
    $('haspName').addEventListener('change', function () { $('haspOtherBox').classList.toggle('hidden', this.value !== '__other__'); renderHaspWho(); });
    $('haspOther').addEventListener('input', renderHaspWho);
    $('haspNotMe').addEventListener('click', haspNotMe);
    $('haspSave').addEventListener('click', saveHasp);
    $('sigClear').addEventListener('click', clearSig);
    var pad = $('sigPad');
    pad.addEventListener('pointerdown', function (e) { sig.drawing = true; var p = sigPos(e), x = pad.getContext('2d'); x.beginPath(); x.moveTo(p[0], p[1]); pad.setPointerCapture(e.pointerId); });
    pad.addEventListener('pointermove', function (e) { if (!sig.drawing) return; var p = sigPos(e), x = pad.getContext('2d'); x.lineTo(p[0], p[1]); x.stroke(); sig.has = true; });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { pad.addEventListener(ev, function () { sig.drawing = false; }); });
    $('vGps').addEventListener('click', function () {
      var b = this; if (!navigator.geolocation) return A.toast('No GPS on this phone.');
      A.busy(b, true, 'Getting location…');
      navigator.geolocation.getCurrentPosition(function (p) {
        A.busy(b, false); b.dataset.ll = JSON.stringify([p.coords.latitude, p.coords.longitude]);
        b.textContent = 'Ramp location captured ✓ (± ' + Math.round(p.coords.accuracy) + ' m)'; b.classList.add('ok');
      }, function (e) { A.busy(b, false); A.toast('No GPS fix: ' + e.message); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    });
    $('vStart').addEventListener('click', startTrip);
    $('pBoard').addEventListener('click', board);
    $('aboardList').addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (b) askDisembark(Number(b.dataset.i)); });
    $('disInj').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; setToggle('disInj', b.dataset.val); $('disDescBox').classList.toggle('hidden', b.dataset.val !== 'Yes'); });
    $('disCancel').addEventListener('click', function () { $('disOverlay').classList.add('hidden'); });
    $('disOk').addEventListener('click', disembark);
    $('vReturn').addEventListener('click', returnTrip);
    window.addEventListener('incident:changed', function () { if (!EMBED_HASP) openHasp = null; render(); });
    window.addEventListener('outbox:changed', function () {
      if (view === '214') { renderMine('214', $('l214List')); renderAlert(); renderPinNote($('l214Pin')); }
      if (view === 'rr') { renderMine('rr', $('rrList')); renderPinNote($('rrPin')); }   // a PIN entered (Outbox.setPin) hides the note
    });

    Store.kvGet('vessel_trip').then(function (t) { trip = t || null; render(); });
    [].forEach.call($('tabs').children, function (b) { b.classList.toggle('hidden', !tabOn(b.dataset.view)); });
    var refreshCfg = function () {
      if (tabOn('hasp')) loadCfg('hasp', CONFIG.HASP_API + '?page=api&action=offline_config');
      if (tabOn('vessel')) loadCfg('vessel', CONFIG.VESSEL_API + '?page=api&action=offline_config');
    };
    refreshCfg();
    window.addEventListener('online', refreshCfg);
    showView(EMBED ? '214' : ((location.hash || '').replace('#', '') || 'recon'));
  }
  window.WRIForms = { showView: function (v) { showView(v); }, refreshRequests: function () { pollRr(true); }, safetyFromRecon: safetyFromRecon,
    logFromRecon: logFromRecon,
    // 2026-11-06 (batch 13): the recon Save screen shows a safety point's alert live (js/app.js renderDone)
    alertView: alertView, pollAlert: function () { pollAlert(); },
    // 2026-11-05 (batch 11): open one HASP to sign (the phone's cached copy, else the Field App's stub); returns it
    openHasp: function (id, stub) {
      var all = [];
      ((cfg.hasp && cfg.hasp.incidents) || []).forEach(function (i) { all = all.concat(i.hasps || []); });
      var h = all.filter(function (x) { return String(x.objectId) === String(id); })[0] || stub;
      showView('hasp'); openHaspDetail(h); return h;
    } };
  document.addEventListener('DOMContentLoaded', boot);
})();
