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
  var TITLES = { recon: 'Recon', drone: 'Drone Photos', '214': 'ICS 214 Log', hasp: 'HASP Sign-off', vessel: 'Vessel Manifest', rr: 'Resource Request', drill: 'Drill Eval' };

  function staff() {
    var a = (S.cfg && S.cfg.staff) || [], b = (cfg.hasp && cfg.hasp.staff) || [], c = (cfg.vessel && cfg.vessel.staff) || [];
    var seen = {}, out = [];
    a.concat(b, c).forEach(function (n) { n = String(n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } });
    return out.sort();
  }
  function fillNames(sel, otherBox, otherInput, withOther) {
    var keep = sel.value || A.lsGet('wri_recon_name') || '';
    sel.innerHTML = '<option value="">Select…</option>' + staff().map(function (n) { return '<option>' + A.esc(n) + '</option>'; }).join('') +
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
    if (r.status === 'sent') return '<span class="s green">Uploaded' + (r.result && r.result.request_id ? ' as ' + A.esc(r.result.request_id) : '') +
      (r.result && r.result.section ? ' to the ' + A.esc(r.result.section) + ' log' : '') + '</span>';
    if (r.status === 'needs_pin') return '<span class="s red">Waiting for the incident PIN</span>';
    if (r.status === 'failed') return '<span class="s red">' + A.esc(r.last_error || 'Could not upload') + '</span>';
    return '<span class="s amber">Waiting to upload' + (r.last_error ? ' (' + A.esc(r.last_error) + ')' : '') + '</span>';
  }
  function renderMine(kind, el) {
    Outbox.list().then(function (rs) {
      var mine = rs.filter(function (r) { return r.kind === kind; }).slice(0, 15);
      el.innerHTML = mine.length ? mine.map(function (r) {
        return '<div class="item"><div class="t">' + A.esc(A.recordTitle(r)) + '</div><div>' + new Date(r.created_at).toLocaleString() +
          ' · ' + A.esc(r.incident ? r.incident.project_key : '') + '</div><div>' + statusLine(r) + '</div></div>';
      }).join('') : '<div class="hint">Nothing yet.</div>';
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
    $('viewTitle').textContent = TITLES[v];
    try { history.replaceState(null, '', location.pathname + location.search + (v === 'recon' ? '' : '#' + v)); } catch (e) {}
    if (v === 'recon') A.invalidateMap();
    render();
  }
  function render() {
    if (view === '214') {
      fillNames($('l214Name'), $('l214OtherBox'), $('l214Other'), true); renderMine('214', $('l214List'));
      if (!$('l214Act').value.trim()) $('l214Time').value = A.localNow();   // the panel can sit open for hours
    }
    if (view === 'rr') { if (!$('rrName').value) $('rrName').value = A.lsGet('wri_recon_name') || ''; renderMine('rr', $('rrList')); }
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
    if (!who) return A.toast('Pick your name.');
    if (!act) return A.toast('Write the activity.');
    var at = $('l214Time').value ? new Date($('l214Time').value).getTime() : Date.now();
    write214(who, act, at, $('l214Save'), true, $('l214Unit').checked);
  }
  function write214(who, act, at, btn, clearAct, unit, done) {   // unit: also post to the unit log (default: my own 214A only)
    A.lsSet('wri_recon_name', who); A.lsSet('wri_214_pos', $('l214Pos').value.trim()); A.lsSet('wri_214_section', $('l214Sec').value);
    // a personal entry waits on the phone while "Add to unit log?" is up (ASK_MS), then uploads
    var rec = { recon_id: A.uuid(), kind: '214', incident: S.incident, hold_until: unit ? 0 : Date.now() + ASK_MS + 2000,
                fields: { person: who, position: $('l214Pos').value.trim(), activity: act, at: at, also_unit: !!unit, section: $('l214Sec').value } };
    save(rec, btn, unit ? '214 note saved to your log and the unit log.' : null, function () {
        if (!unit) askUnit(rec.recon_id, act);
        if (clearAct) $('l214Act').value = '';
        $('l214Time').value = A.localNow(); renderMine('214', $('l214List'));
        $('l214Unit').checked = false; $('q214Unit').checked = false;   // every entry starts personal
        if (done) done();
        if (EMBED && window.parent !== window) try { window.parent.postMessage({ type: 'wri-214', action: 'saved', activity: act }, location.origin); } catch (e) {}
      });
  }

  // After a personal 214: "Saved to your log. Add to unit log?" with a button.
  // Until it's answered (or ASK_MS passes) the entry is held on the phone, so
  // the button just flips also_unit before it uploads.
  var ASK_MS = 12000, ask = null;
  function askUnit(id, act) {
    endAsk(false);
    ask = { id: id, timer: setTimeout(function () { endAsk(false); }, ASK_MS) };
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
      A.toast(ok ? 'Added to the unit log too.' + (navigator.onLine ? ' Uploading…' : ' It uploads when you’re back in coverage.')
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
  function needsDetail(item) { return /\u2026$/.test(item[0]); }
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
    $('q214Pills').innerHTML = g.items.map(function (it, j) {
      return '<button type="button" class="q-pill q-' + A.esc(it[2] || 'info') + '" data-j="' + j + '"><span class="q-ico">' + A.esc(it[1] || '') +
        '</span><span>' + A.esc(it[0].replace(/\u2026$/, '')) + '</span></button>';
    }).join('');
    $('q214Det').value = '';
    qSync();
    $('q214Home').classList.add('hidden'); $('q214Page').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function closeCat() {
    qCat = null; qPick = null;
    $('q214Page').classList.add('hidden'); $('q214Home').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function qSync() {   // pill highlight, details label, submit text
    [].forEach.call($('q214Pills').children, function (b) { b.classList.toggle('sel', qPick !== null && Number(b.dataset.j) === qPick); });
    var it = qCat && qPick !== null ? qCat.items[qPick] : null, b = $('q214Submit');
    $('q214DetLbl').textContent = it && needsDetail(it) ? 'Details (needed)' : 'Details (optional)';
    b.disabled = !it;
    b.textContent = it ? 'Log it: ' + it[0].replace(/\u2026$/, '') : 'Pick an activity';
  }
  function submitQuick() {
    if (!qCat || qPick === null) return;
    if (!needIncident()) return;
    var who = pickedName($('l214Name'), $('l214Other'));
    if (!who) { A.toast('Pick your name at the top first.'); window.scrollTo(0, 0); $('l214Name').focus(); return; }
    var it = qCat.items[qPick], label = it[0].replace(/\u2026$/, ''), det = $('q214Det').value.trim();
    if (needsDetail(it) && !det) { A.toast('\u201c' + label + '\u201d needs details. Type them in the Details box, then tap Log it.', 5000); $('q214Det').focus(); return; }
    write214(who, det ? label + ' \u2014 ' + det : label, Date.now(), $('q214Submit'), false, $('q214Unit').checked, closeCat);
  }

  // ---------- 213-RR ----------
  function saveRr() {
    if (!needIncident()) return;
    var item = $('rrItem').value.trim(), who = $('rrName').value.trim();
    if (!item) return A.toast('Describe what you need.');
    if (!who) return A.toast('Enter your name.');
    var pr = (document.querySelector('#rrPri .active') || {}).dataset;
    A.lsSet('wri_recon_name', who); A.lsSet('wri_rr_pos', $('rrPos').value.trim());
    save({ recon_id: A.uuid(), kind: 'rr', incident: S.incident, fields: {
        item: item, qty: $('rrQty').value.trim() || '1', uom: $('rrUom').value.trim() || 'EA', priority: (pr && pr.val) || 'R',
        delivery: $('rrWhere').value.trim(), arrival: $('rrWhen').value.trim(), notes: $('rrNotes').value.trim(),
        requester: who, position: $('rrPos').value.trim(), at: Date.now() } },
      $('rrSave'), 'Request saved.', function () {
        ['rrItem', 'rrWhere', 'rrWhen', 'rrNotes'].forEach(function (id) { $(id).value = ''; }); $('rrQty').value = '1'; $('rrUom').value = 'EA';
        renderMine('rr', $('rrList'));
      });
  }

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
    $('haspRead').checked = false; clearSig(); sizeSig();
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
      var nm = /[?&]name=([^&#]+)/.exec(location.search);   // the Field App's checked-in name
      if (nm && !A.lsGet('wri_recon_name')) A.lsSet('wri_recon_name', decodeURIComponent(nm[1].replace(/\+/g, ' ')).trim());
      window.addEventListener('message', function (e) {   // panel reopened: refresh the time and the list
        if (e.origin === location.origin && e.data && e.data.type === 'wri-214' && e.data.action === 'open') render();
      });
    }
    buildQuick();
    $('q214Cats').addEventListener('click', function (e) { var b = e.target.closest('.q-cat'); if (b) openCat(Number(b.dataset.i)); });
    $('q214Pills').addEventListener('click', function (e) {
      var b = e.target.closest('.q-pill'); if (!b) return;
      var j = Number(b.dataset.j); qPick = qPick === j ? null : j; qSync();
      var it = qPick !== null ? qCat.items[qPick] : null;
      if (it && needsDetail(it) && !$('q214Det').value.trim()) {   // tell them before they tap Log it
        A.toast('“' + it[0].replace(/…$/, '') + '” needs details. Type them in the Details box below, then tap Log it.', 5000);
        $('q214Det').scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    $('l214AskYes').addEventListener('click', function () { endAsk(true); });
    $('l214AskNo').addEventListener('click', function () { endAsk(false); });
    $('q214Back').addEventListener('click', closeCat);
    $('q214Submit').addEventListener('click', submitQuick);
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) showView(b.dataset.view); });
    $('l214Time').value = A.localNow(); $('l214Pos').value = A.lsGet('wri_214_pos') || ''; $('l214Sec').value = A.lsGet('wri_214_section') || ''; $('rrPos').value = A.lsGet('wri_rr_pos') || '';
    $('l214Name').addEventListener('change', function () { $('l214OtherBox').classList.toggle('hidden', this.value !== '__other__'); });
    $('l214Save').addEventListener('click', save214);
    $('rrPri').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setToggle('rrPri', b.dataset.val); });
    $('rrSave').addEventListener('click', saveRr);
    $('haspList').addEventListener('click', function (e) { var b = e.target.closest('.hasp-item'); if (b) openHaspDetail(haspsForIncident()[Number(b.dataset.i)]); });
    $('haspBack').addEventListener('click', function () { openHasp = null; renderHasp(); });
    $('haspName').addEventListener('change', function () { $('haspOtherBox').classList.toggle('hidden', this.value !== '__other__'); });
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
    window.addEventListener('incident:changed', function () { openHasp = null; render(); });
    window.addEventListener('outbox:changed', function () { if (view === '214') renderMine('214', $('l214List')); if (view === 'rr') renderMine('rr', $('rrList')); });

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
  window.WRIForms = { showView: function (v) { showView(v); } };
  document.addEventListener('DOMContentLoaded', boot);
})();
