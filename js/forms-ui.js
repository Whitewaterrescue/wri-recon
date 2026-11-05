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
  function fillNames(sel, otherBox, otherInput, withOther) {
    // 2026-11-05 (batch 11): the checked-in name first (the person holding the phone), then the last name used here
    var keep = sel.value || (notMe ? '' : checkinName()) || A.lsGet('wri_recon_name') || '';
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
    if (view === 'rr') { if (!$('rrName').value) $('rrName').value = A.lsGet('wri_recon_name') || checkinName(); renderMine('rr', $('rrList')); pollRr(); }
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
  function write214(who, act, at, btn, clearAct, unit, done, urgent) {   // unit: also post to the unit log (default: my own 214A only)
    if (urgent) unit = true;
    var quiet = !unit && noAskToday(who);   // "Don't ask again today": personal entries go straight up
    var pos = $('l214Pos').value.trim();
    if (pos !== myPosition(who)) A.lsSet('wri_214_pos_at', String(Date.now()));   // typed over the check-in's: it wins from now on
    A.lsSet('wri_recon_name', who); A.lsSet('wri_214_pos', pos); A.lsSet('wri_214_section', $('l214Sec').value);
    // a personal entry waits on the phone while "Add to unit log?" is up (ASK_MS), then uploads
    var rec = { recon_id: A.uuid(), kind: '214', incident: S.incident, hold_until: unit || quiet ? 0 : Date.now() + ASK_MS + 2000,
                fields: { person: who, position: $('l214Pos').value.trim(), activity: act, at: at, also_unit: !!unit,
                          section: urgent ? 'safety' : $('l214Sec').value, default_section: 'operations' } };
    if (urgent) rec.fields.urgent = urgent;
    save(rec, btn, urgent ? null : unit ? '214 note saved to your log and ' + unitDest() + '.' : quiet ? 'Saved to your 214 log.' : null, function () {
        if (urgent) {
          trackAlert(rec, urgent); renderAlert();
          A.toast(navigator.onLine ? 'Sending the ' + URG_LABEL[urgent] + ' alert to the Incident Commander and Safety Officer. Still radio them.'
            : 'No signal: the ' + URG_LABEL[urgent] + ' alert goes out when signal returns. Radio your supervisor and the Safety Officer now.', 12000);
        }
        if (!unit && !quiet) askUnit(rec.recon_id, act, who);
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
    qSync();
    $('q214Home').classList.add('hidden'); $('q214Page').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function closeCat() {
    qCat = null; qPick = null;
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
    b.textContent = it ? 'Log it: ' + it[0].replace(/\u2026$/, '') + (urg ? ' (my log + Safety)' : u.checked ? ' (my log + unit log)' : '') : 'Pick an activity';
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
    write214(who, act, Date.now(), $('q214Submit'), false, $('q214Unit').checked, closeCat, '');
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
    $('urgMsg').innerHTML = 'This alerts the <b>Incident Commander</b> and the <b>Safety Officer</b> (email, and a text where it is set up) and logs it to your log and the Safety unit log.' +
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
  function alertState(al, r) {   // {cls, html, done}
    var res = r && r.status === 'sent' ? (r.result && r.result.alert) : null, ack = (al && al.ack) || (res && res.ack);
    if (ack) return { cls: 'ok', done: true, html: '<b>Acknowledged by ' + A.esc(ack.name) + (ack.at ? ' at ' + hhmm(ack.at) : '') + '.</b>' };
    if (!r) return { cls: 'bad', done: true, html: '<b>This alert is no longer saved on the phone.</b>' + RADIO };
    if (r.status === 'needs_pin') return { cls: 'bad', html: '<b>Not sent yet: it is waiting for the incident PIN.</b>' + RADIO };
    if (r.status === 'failed') return { cls: 'bad', html: '<b>The alert could not be sent</b> (' + A.esc(r.last_error || 'error') + ').' + RADIO };
    if (r.status !== 'sent') return navigator.onLine && r.last_error !== 'No signal'
      ? { cls: 'warn', html: '<span class="spin"></span><b>Sending the alert…</b>' + RADIO }
      : { cls: 'bad', html: '<b>No signal: the alert goes out when signal returns.</b>' + RADIO };
    if (!res) return { cls: 'bad', done: true, html: '<b>Saved to the Safety unit log, but no alert went out</b> (the server is not updated yet).' + RADIO };
    var to = res.sent_to || [];
    if (!to.length) return { cls: 'bad', done: true, html: '<b>Nobody could be alerted.</b> ' + A.esc(res.error || '') + RADIO };
    var late = Date.now() - (r.sent_at || al.at) > ALERT_POLL_MS;
    return { cls: 'warn', done: late, html: '<b>Alert sent to ' + A.esc(nameList(to)) + '.</b> ' +
      (late ? 'No acknowledgement after 30 minutes.' : '<span class="spin"></span>Waiting for acknowledgement…') + ' Still radio them.' +
      (res.not_reached && res.not_reached.length ? ' Could not reach ' + A.esc(nameList(res.not_reached)) + ' (no email or phone on file).' : '') };
  }
  function alertLine(r) {   // the short version in "My entries today"
    var al = alertOf(r.recon_id), res = r.status === 'sent' && r.result && r.result.alert, ack = (al && al.ack) || (res && res.ack);
    var t = ack ? 'Alert acknowledged by ' + ack.name + (ack.at ? ' at ' + hhmm(ack.at) : '')
      : res && (res.sent_to || []).length ? 'Alert sent to ' + nameList(res.sent_to) + ', not acknowledged yet'
      : r.status === 'sent' ? 'No alert went out: radio them' : 'Alert waiting to go out';
    return '<div class="s ' + (ack ? 'green' : 'red') + '">' + A.esc(t) + '</div>';
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
  function gotAck(id, ack) {
    var a = alerts(), hit = a.filter(function (x) { return x.id === id; })[0];
    if (!hit || hit.ack) return;
    hit.ack = { name: ack.name, at: ack.at }; saveAlerts(a);
    A.toast('Acknowledged by ' + ack.name + (ack.at ? ' at ' + hhmm(ack.at) : '') + '.', 8000);
    renderAlert(); if (view === '214') renderMine('214', $('l214List'));
  }
  function pollAlert() {   // gently: every 20 s while the app is open, until acknowledged or 30 min
    if (alertPolling || !navigator.onLine || document.visibilityState === 'hidden') return;
    var al = alerts().filter(function (x) { return !x.ack && Date.now() - x.at < ALERT_SHOW_MS; }).pop();
    if (!al) return;
    alertPolling = true;
    Store.get('records', al.id).then(function (r) {
      var res = r && r.status === 'sent' && r.result && r.result.alert;
      if (!res || !(res.sent_to || []).length) return;
      if (res.ack) return gotAck(al.id, res.ack);
      if (Date.now() - (r.sent_at || al.at) > ALERT_POLL_MS) return;
      return Promise.all([Outbox.pinFor(al.inc), Store.deviceId()]).then(function (a) {
        if (!a[0]) return;
        return Api.post('offline_alert_status', { pin: a[0], device: a[1], id: al.id, incident_id: al.inc }, 20000, CONFIG.LOGISTICS_API)
          .then(function (d) { if (d && d.ack) gotAck(al.id, d.ack); });
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
              fields: { person: who, position: myPosition(who), activity: act, at: f.observation_epoch || Date.now(), also_unit: true,
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
      $('rrSave'), 'Request saved. Logistics sees it on the Incident Board within about 5 minutes of uploading.', function () {
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
      // the checked-in person is the one holding the phone: their name wins over the last user's (Jordan 2026-11-04)
      if (nm) A.lsSet('wri_recon_name', decodeURIComponent(nm[1].replace(/\+/g, ' ')).trim());
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
      qPick = qPick === j ? null : j; qSync();
      var it = qPick !== null ? qCat.items[qPick] : null;
      if (it && needsDetail(it) && !$('q214Det').value.trim()) {   // tell them before they tap Log it
        A.toast('“' + it[0].replace(/…$/, '') + '” needs details. Type them in the Details box, then tap Log it.', 5000);
        $('q214Det').scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    $('q214Pills').addEventListener('click', onPick);
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
    $('l214Time').value = A.localNow(); $('l214Sec').value = A.lsGet('wri_214_section') || ''; $('rrPos').value = A.lsGet('wri_rr_pos') || '';
    $('l214Pos').value = myPosition(checkinName());   // batch 11: the check-in position
    renderDest();
    $('l214Name').addEventListener('change', function () { $('l214OtherBox').classList.toggle('hidden', this.value !== '__other__'); renderWho(); renderMine('214', $('l214List')); });
    $('l214Other').addEventListener('change', function () { renderWho(); renderMine('214', $('l214List')); });
    $('l214Sec').addEventListener('change', function () { A.lsSet('wri_214_section', this.value); renderDest(); qSync(); });
    $('l214NotMe').addEventListener('click', function () {   // hand-off on a shared phone: pick the right name first
      notMe = true; A.lsSet('wri_recon_name', ''); $('l214Name').value = ''; $('l214Other').value = ''; $('l214OtherBox').classList.add('hidden');
      renderWho(); renderMine('214', $('l214List')); $('l214Name').focus();
    });
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
    window.addEventListener('incident:changed', function () { if (!EMBED_HASP) openHasp = null; render(); });
    window.addEventListener('outbox:changed', function () { if (view === '214') { renderMine('214', $('l214List')); renderAlert(); } if (view === 'rr') renderMine('rr', $('rrList')); });

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
    // 2026-11-05 (batch 11): open one HASP to sign (the phone's cached copy, else the Field App's stub); returns it
    openHasp: function (id, stub) {
      var all = [];
      ((cfg.hasp && cfg.hasp.incidents) || []).forEach(function (i) { all = all.concat(i.hasps || []); });
      var h = all.filter(function (x) { return String(x.objectId) === String(id); })[0] || stub;
      showView('hasp'); openHaspDetail(h); return h;
    } };
  document.addEventListener('DOMContentLoaded', boot);
})();
