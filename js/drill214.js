/* WRI field app (offline): drill "requirement met" taps inside the ICS 214 tab (Cody 2026-11-11).
 *
 * The Field App's red LOG 214 pill opens this tab (?embed=214), so evaluators and observers take the same
 * route as any 214 note. On a drill incident (admin Drill setup -> config drill_form / drill_items) the 214
 * page gets a "DRILL: requirement met" card. It opens a list of ONLY the requirements picked for this drill
 * (NPREP components, WA Ecology credits, Cal OSPR DFW 1955 objectives, CO PUC or Minnesota requirements).
 *
 * One tap (+ Met on the confirm sheet) queues, through the outbox (works with no signal):
 *   - a Drill_Eval row: entry_kind observation, status observed, category 'met', item_key, at  (the packager
 *     credits the item and puts "Requirement met: <label>" on the drill timeline at that time), and
 *   - one ICS 214 line, "Drill requirement met: <label>", on the tapper's 214 and unit log (the packager skips
 *     these lines on the timeline, so the event shows once).
 * Undo = a soft delete of the Drill_Eval row (drilldel); the 214 line stays, it is a log.
 * Other evaluators' taps come from offline_drill_eval_list (wri-logistics) when online.
 */
(function () {
  var A, $, S;
  var MET_PREFIX = 'Drill requirement met: ';
  var server = { inc: '', at: 0, rows: [] };   // last offline_drill_eval_list answer
  var pick = null;                              // the item on the confirm sheet

  function row() {
    var id = S.incident && S.incident.incident_id;
    return ((S.cfg && S.cfg.incidents) || []).filter(function (x) { return x.incident_id === id; })[0] || null;
  }
  // The drill's requirement list: drill_items from the admin (2026-11-11), else the older NPREP / Ecology picks.
  function items() {
    var r = row();
    if (!r) return [];
    if (Array.isArray(r.drill_items) && r.drill_items.length) return r.drill_items;
    var legacy = window.DrillUI && window.DrillUI.legacyItems ? window.DrillUI.legacyItems(r) : [];
    return legacy || [];
  }
  var FORM_NAMES = { nprep: 'NPREP', ecy: 'WA Ecology', ospr: 'Cal OSPR', copuc: 'CO PUC', mn: 'Minnesota' };
  function formName() {   // "NPREP + Minnesota" (2026-11-11: NPREP and / or one state form)
    var r = row() || {}, st = r.drill_form && r.drill_form !== 'nprep' ? r.drill_form : (r.drill_ecology ? 'ecy' : '');
    var np = r.drill_nprep != null ? !!r.drill_nprep : !st;
    return [np ? 'NPREP' : '', st ? FORM_NAMES[st] : ''].filter(Boolean).join(' + ') || 'NPREP';
  }

  function who() {
    var sel = $('l214Name');
    if (!sel) return '';
    return sel.value === '__other__' ? ($('l214Other').value || '').trim() : sel.value;
  }
  function hhmm(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  // item_key -> {at, by, id, local} for the met taps on this incident (this phone + the server), deletes removed
  function metMap() {
    var inc = S.incident && S.incident.incident_id;
    return Outbox.list().then(function (rs) {
      var gone = {}, m = {};
      rs.forEach(function (r) { if (r.kind === 'drilldel') gone[(r.fields || {}).target_id] = 1; });
      if (server.inc === inc) server.rows.forEach(function (x) {
        if (x.category !== 'met' || gone[x.entry_id]) return;
        var t = Date.parse(x.entry_time) || 0;
        if (!m[x.item_key] || t < m[x.item_key].at) m[x.item_key] = { at: t, by: x.evaluator_name || '', id: x.entry_id, local: false };
      });
      rs.forEach(function (r) {
        var f = r.fields || {};
        if (r.kind !== 'drill' || f.category !== 'met' || gone[r.recon_id]) return;
        if (!r.incident || r.incident.incident_id !== inc) return;
        if (!m[f.item_key] || f.at < m[f.item_key].at) m[f.item_key] = { at: f.at, by: f.evaluator_name || '', id: r.recon_id, local: r.status !== 'sent' };
      });
      return m;
    });
  }

  function fetchServer() {
    var inc = S.incident && S.incident.incident_id;
    if (!inc || !navigator.onLine || !window.Api || !CONFIG.LOGISTICS_API) return Promise.resolve();
    if (server.inc === inc && Date.now() - server.at < 30000) return Promise.resolve();
    return Promise.all([Outbox.pinFor(inc), Store.deviceId()]).then(function (a) {
      if (!a[0]) return;
      return Api.post('offline_drill_eval_list', { pin: a[0], device: a[1], incident_id: inc }, 20000, CONFIG.LOGISTICS_API).then(function (d) {
        server = { inc: inc, at: Date.now(), rows: (d && d.entries) || [] };
      });
    }).catch(function () {});
  }

  // ---- the card on the 214 category page ----
  function renderCard() {
    var el = $('d214Card');
    if (!el) return;
    var list = items();
    if (!list.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    metMap().then(function (m) {
      var n = list.filter(function (it) { return m[it.key]; }).length;
      el.classList.remove('hidden');
      el.innerHTML = '<button type="button" class="d214-card" id="d214Open"><span class="d214-k">DRILL</span>' +
        '<span class="d214-t">Requirement met</span><span class="d214-n">' + n + ' of ' + list.length + ' met · ' + A.esc(formName()) + '</span></button>';
      $('d214Open').onclick = openPage;
    });
  }

  // ---- the requirement list ----
  function openPage() {
    if (!S.incident) return A.toast('Pick the incident at the top first.');
    $('q214Home').classList.add('hidden'); $('q214Page').classList.add('hidden'); $('d214Page').classList.remove('hidden');
    $('d214Head').textContent = 'Drill requirements · ' + formName();
    renderPage();
    fetchServer().then(renderPage);
    window.scrollTo(0, 0);
  }
  function closePage() {
    $('d214Page').classList.add('hidden'); $('q214Home').classList.remove('hidden');
    renderCard();
    window.scrollTo(0, 0);
  }
  function renderPage() {
    if ($('d214Page').classList.contains('hidden')) return;
    var list = items();
    metMap().then(function (m) {
      var last = '';
      $('d214List').innerHTML = list.map(function (it) {
        var g = it.group && it.group !== last ? '<div class="sub-title">' + A.esc(it.group) + '</div>' : '';
        last = it.group || last;
        var x = m[it.key];
        return g + '<button type="button" class="d214-item' + (x ? ' met' : '') + '" data-k="' + A.esc(it.key) + '">' +
          '<span class="d214-box">' + (x ? '&#10003;' : '') + '</span><span class="d214-l">' + A.esc(it.label) +
          (x ? '<span class="d214-s">Met ' + hhmm(x.at) + (x.by ? ' · ' + A.esc(x.by) : '') + (x.local ? ' · waiting to upload' : '') + '</span>' : '') +
          '</span></button>';
      }).join('') || '<div class="hint">No requirements are set for this drill. Ask the admin to finish the Drill setup.</div>';
      [].forEach.call($('d214List').querySelectorAll('.d214-item'), function (b) {
        b.onclick = function () { openSheet(list.filter(function (it) { return it.key === b.dataset.k; })[0], m[b.dataset.k]); };
      });
    });
  }

  // ---- the confirm sheet ----
  function openSheet(it, met) {
    if (!it) return;
    pick = { it: it, met: met };
    $('d214SheetTitle').textContent = it.label;
    var tip = it.prompt || (window.DrillUI && window.DrillUI.promptFor ? window.DrillUI.promptFor(it.key) : '');
    $('d214Tip').textContent = tip ? 'Note: ' + tip : '';
    $('d214Tip').classList.toggle('hidden', !tip);
    $('d214Note').value = '';
    $('d214Time').value = A.localNow();
    $('d214MetBox').classList.toggle('hidden', !!met);
    $('d214Was').classList.toggle('hidden', !met);
    $('d214Was').innerHTML = met ? 'Met at <b>' + hhmm(met.at) + '</b>' + (met.by ? ' by ' + A.esc(met.by) : '') + '.' : '';
    $('d214Undo').classList.toggle('hidden', !met);
    $('d214Met').classList.toggle('hidden', !!met);
    $('d214Overlay').classList.remove('hidden');
  }
  function closeSheet() { pick = null; $('d214Overlay').classList.add('hidden'); }

  function saveMet() {
    if (!pick) return;
    var name = who();
    if (!name) { closeSheet(); A.toast('Pick your name at the top first.'); window.scrollTo(0, 0); return; }
    var it = pick.it, note = $('d214Note').value.trim();
    var at = $('d214Time').value ? new Date($('d214Time').value).getTime() : Date.now();
    if (!(at > 0)) at = Date.now();
    var btn = $('d214Met');
    A.busy(btn, true, 'Saving…');
    var drill = { recon_id: A.uuid(), kind: 'drill', incident: S.incident,
                  fields: { entry_kind: 'observation', status: 'observed', category: 'met', at: at, evaluator_name: name,
                            item_key: it.key, item_label: it.label, note: note } };
    var log = { recon_id: A.uuid(), kind: '214', incident: S.incident, hold_until: 0,
                fields: { person: name, position: A.lsGet('wri_214_pos') || '', activity: MET_PREFIX + it.label + (note ? ' — ' + note : ''),
                          at: at, also_unit: true, section: $('l214Sec') ? $('l214Sec').value : '', default_section: 'operations',
                          drill_item: it.key } };
    A.lsSet('wri_recon_name', name);
    Outbox.enqueue(drill, []).then(function () { return Outbox.enqueue(log, []); }).then(function () {
      A.busy(btn, false); closeSheet();
      A.toast('Met: ' + it.label + ' at ' + hhmm(at) + '.' + (navigator.onLine ? ' Uploading…' : ' No signal: it uploads when you’re back in coverage.'));
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
      if (window.parent !== window) try { window.parent.postMessage({ type: 'wri-214', action: 'saved', activity: log.fields.activity }, location.origin); } catch (e) {}
      renderPage(); renderCard();
    }, function (e) { A.busy(btn, false); A.toast('Could not save on this phone: ' + e.message, 8000); });
  }

  function undo() {
    if (!pick || !pick.met) return;
    var btn = $('d214Undo'), it = pick.it, target = pick.met.id;
    A.busy(btn, true, 'Undoing…');
    Outbox.enqueue({ recon_id: A.uuid(), kind: 'drilldel', incident: S.incident,
                     fields: { target_id: target, deleted: true, label: 'Met: ' + it.label } }, []).then(function () {
      A.busy(btn, false); closeSheet();
      server.rows = server.rows.filter(function (x) { return x.entry_id !== target; });
      A.toast('Undone: ' + it.label + ' is no longer marked met. (The 214 line stays in the log.)', 6000);
      renderPage(); renderCard();
    }, function (e) { A.busy(btn, false); A.toast('Could not undo: ' + e.message, 8000); });
  }

  function boot() {
    A = window.WRIApp; $ = A.$; S = A.S;
    if (!$('d214Card')) return;
    $('d214Back').addEventListener('click', closePage);
    $('d214Met').addEventListener('click', saveMet);
    $('d214Undo').addEventListener('click', undo);
    $('d214Cancel').addEventListener('click', closeSheet);
    $('d214Now').addEventListener('click', function () { $('d214Time').value = A.localNow(); });
    window.addEventListener('incident:changed', function () {
      if (!$('d214Page').classList.contains('hidden')) closePage(); else renderCard();
      fetchServer().then(renderCard);
    });
    window.addEventListener('outbox:changed', function () { renderCard(); renderPage(); });
    window.addEventListener('message', function (e) {   // the Field App reopened the LOG 214 panel: refresh who met what
      if (e.origin === location.origin && e.data && e.data.type === 'wri-214' && e.data.action === 'open') {
        server.at = 0; fetchServer().then(function () { renderCard(); renderPage(); });
      }
    });
    renderCard();
    fetchServer().then(renderCard);
  }
  window.Drill214 = { render: renderCard, MET_PREFIX: MET_PREFIX };
  document.addEventListener('DOMContentLoaded', boot);
})();
