/* WRI field app (offline) — the Drill Eval tab (2026-10-30).
 * 2026-10-31: the component list follows the Drill setup picks (incident drill_components / drill_ecy), Washington Ecology
 *   credits on Ecology drills (item_key ecy_<code>), "Show all" for the rest.
 *
 * What the evaluator records live during a BNSF / agency drill, for the BNSF drill package:
 *   Timeline      a step and its time (tick "Scenario" for simulated exercise-play times)
 *   Notification  who was notified, how, by whom, the case / ticket number
 *   Observation   a core component / objective: Observed / Exercised, not observed / N/A + a note
 *   Hot wash      went well / improve / design / general / action item (who + when)
 * Saved on the phone first; the outbox uploads to wri-logistics (offline_drill_eval ->
 * WRI.drillEvalAdd -> WRI_Incident_Ops Drill_Eval). Delete = a soft delete sent the same way.
 */
(function () {
  var A, $, S;
  var mode = 'timeline';
  var COMPONENTS = [
    ['notifications', '1. Notifications'], ['staff_mobilization', '2. Staff mobilization'], ['ics', '3. Operate within ICS'],
    ['source_control', '4. Source control'], ['assessment', '5. Assessment'], ['containment', '6. Containment'],
    ['recovery', '7. Recovery'], ['protection', '8. Protection'], ['disposal', '9. Disposal'], ['communications', '10. Communications'],
    ['transportation', '11. Transportation'], ['personnel_support', '12. Personnel support'], ['equipment', '13. Equipment maint. & support'],
    ['procurement', '14. Procurement'], ['documentation', '15. Documentation'],
    ['dpx_A', 'DPX A: Organize'], ['dpx_B', 'DPX B: Deploy key equipment'],
    ['frp_A', 'FRP A: OSRO deployment'], ['frp_B', 'FRP B: Equipment operational']
  ];
  var HOT = [['well', 'Went well'], ['improve', 'Improve'], ['design', 'Design'], ['general', 'General'], ['action', 'Action item']];

  function setToggle(id, val) { [].forEach.call($(id).children, function (b) { b.classList.toggle('active', b.dataset.val === val); }); }
  function toggled(id) { var b = document.querySelector('#' + id + ' .active'); return b ? b.dataset.val : ''; }

  function showMode(m) {
    mode = m;
    setToggle('deMode', m);
    ['timeline', 'notification', 'observation', 'hotwash'].forEach(function (k) { $('de_' + k).classList.toggle('hidden', k !== m); });
    $('deActBox').classList.toggle('hidden', !(m === 'hotwash' && toggled('deHot') === 'action'));
  }

  function save() {
    if (!S.incident) return A.toast('Pick the incident at the top first.');
    var who = $('deName').value.trim();
    if (!who) return A.toast('Enter your name.');
    var at = $('deTime').value ? new Date($('deTime').value).getTime() : Date.now();
    var f = { entry_kind: mode, at: at, evaluator_name: who };
    if (mode === 'timeline') {
      f.item_label = $('deStep').value.trim(); f.category = $('deScen').checked ? 'scenario' : 'real';
      if (!f.item_label) return A.toast('Write what happened.');
    } else if (mode === 'notification') {
      f.item_label = $('deNotified').value.trim(); f.contact = $('deMethod').value.trim();
      f.action_who = $('deBy').value.trim(); f.ref_number = $('deRef').value.trim();
      if (!f.item_label) return A.toast('Who was notified?');
    } else if (mode === 'observation') {
      var k = $('deComp').value;
      if (!k) return A.toast('Pick the component.');
      f.item_key = k; f.item_label = $('deComp').selectedOptions[0].textContent; f.status = toggled('deStat'); f.note = $('deObsNote').value.trim();
      if (!f.status) return A.toast('Observed, exercised-not-observed or N/A?');
    } else {
      f.category = toggled('deHot'); f.note = $('deHotNote').value.trim();
      if (!f.note) return A.toast('Write the hot wash point.');
      if (f.category === 'action') { f.action_who = $('deActWho').value.trim(); f.action_when = $('deActWhen').value.trim(); }
    }
    A.lsSet('wri_recon_name', who);
    var btn = $('deSave');
    A.busy(btn, true, 'Saving…');
    Outbox.enqueue({ recon_id: A.uuid(), kind: 'drill', incident: S.incident, fields: f }, []).then(function () {
      A.busy(btn, false);
      A.toast('Saved.' + (navigator.onLine ? ' Uploading…' : ' No signal: it uploads when you’re back in coverage.'));
      ['deStep', 'deNotified', 'deMethod', 'deBy', 'deRef', 'deObsNote', 'deHotNote', 'deActWho', 'deActWhen'].forEach(function (id) { $(id).value = ''; });
      $('deScen').checked = false; $('deTime').value = A.localNow();
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
      render();
    }, function (e) { A.busy(btn, false); A.toast('Could not save on this phone: ' + e.message, 8000); });
  }

  function del(r) {
    if (!confirm('Delete this entry?')) return;
    Outbox.enqueue({ recon_id: A.uuid(), kind: 'drilldel', incident: r.incident, fields: { target_id: r.recon_id, deleted: true,
      label: A.recordTitle(r) } }, []).then(function () { A.toast('Delete queued.'); render(); });
  }

  function line(r) {
    var f = r.fields || {}, t = new Date(f.at || r.created_at);
    var st = r.status === 'sent' ? '<span class="s green">Uploaded</span>' : r.status === 'failed' ? '<span class="s red">' + A.esc(r.last_error || 'Could not upload') + '</span>'
      : r.status === 'needs_pin' ? '<span class="s red">Waiting for the incident PIN</span>' : '<span class="s amber">Waiting to upload</span>';
    return '<div class="item"><div class="t">' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + A.esc(A.recordTitle(r)) + '</div>' +
      '<div>' + st + ' <button type="button" class="link" data-del="' + A.esc(r.recon_id) + '">Delete</button></div></div>';
  }

  function render() {
    if (!$('deList')) return;
    if (!$('deName').value) $('deName').value = A.lsGet('wri_recon_name') || '';
    $('deNames').innerHTML = ((S.cfg && S.cfg.staff) || []).map(function (n) { return '<option value="' + A.esc(n) + '">'; }).join('');
    Outbox.list().then(function (rs) {
      var gone = {};
      rs.forEach(function (r) { if (r.kind === 'drilldel') gone[(r.fields || {}).target_id] = 1; });
      var inc = S.incident && S.incident.incident_id;
      var mine = rs.filter(function (r) { return r.kind === 'drill' && !gone[r.recon_id] && (!inc || (r.incident && r.incident.incident_id === inc)); })
        .sort(function (a, b) { return ((b.fields || {}).at || b.created_at) - ((a.fields || {}).at || a.created_at); }).slice(0, 40);
      $('deList').innerHTML = mine.length ? mine.map(line).join('') : '<div class="hint">No drill entries on this phone yet.</div>';
      $('deList').querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () { del(mine.filter(function (r) { return r.recon_id === b.dataset.del; })[0]); };
      });
    });
  }

  // Components picked at the admin's Drill setup (Cody 2026-10-31): only those (+ the DPX / FRP objectives) are
  // listed; "Show all" lists every one. No picks for the incident = everything, as before.
  // Washington Ecology deployment-drill credits (same codes as the admin's Drill setup and the packager's checklist)
  var ECY = [
    ['1.1', 'Internal response team notified'], ['1.2', 'Entire response organization notified'], ['1.3', 'Government notifications (NRC / EMD #)'],
    ['5.A1', 'Initial site safety'], ['5.A2', 'Local response team mobilized'], ['5.A3', 'Personnel appropriate to conditions'],
    ['5.A5', 'PH comms field-tested'], ['5.A6', 'PH & contractor comms during deployment'], ['5.A7', 'Spill-tracking equipment deployed'],
    ['5.B1', 'Boom / recovery / interim storage deployed'], ['5.B2', 'PH-owned boom deployed'], ['5.B3', 'PH-owned mechanical recovery'],
    ['5.B4', 'Non-floating oils equipment sourcing'], ['5.B5', 'Transfer to shoreside storage'], ['5.B6', 'Land-spill containment'],
    ['5.B7', 'Damage control procedures'], ['5.B9', 'Large-scale equipment deployment'], ['5.C1', 'GRP / protection strategy deployed'],
    ['5.D1', 'Oiled-wildlife equipment deployed']
  ];

  // What the admin's Drill setup picked for the incident (Cody 2026-10-31): only the picked NPREP components (+ the
  // DPX / FRP objectives) and, on an Ecology drill, only the picked Ecology credits are listed; "Show all" lists
  // every one. Nothing picked = everything, as before.
  function plan() {
    var id = S.incident && S.incident.incident_id;
    var r = ((S.cfg && S.cfg.incidents) || []).filter(function (x) { return x.incident_id === id; })[0] || {};
    return { cmp: r.drill_components || [], ecology: !!r.drill_ecology, ecy: r.drill_ecy || [] };
  }
  function fillComponents() {
    var p = plan(), cur = $('deComp').value, showAll = $('deAll').checked;
    $('deAllBox').classList.toggle('hidden', !p.cmp.length && !p.ecy.length && !p.ecology);
    var opt = function (key, label, picked) {
      return '<option value="' + key + '"' + (key === cur ? ' selected' : '') + '>' + A.esc(label) + (picked ? ' (planned)' : '') + '</option>';
    };
    var allC = !p.cmp.length || showAll;
    var html = '<option value="">Select…</option>';
    // one form per drill (Cody 2026-10-31): an Ecology drill lists the Ecology credits, NPREP only under Show all
    if (!p.ecology || showAll) html += '<optgroup label="NPREP core components">' + COMPONENTS.filter(function (c) {
      return allC || p.cmp.indexOf(c[0]) >= 0 || /^(dpx|frp)_/.test(c[0]);
    }).map(function (c) { return opt(c[0], c[1], allC && p.cmp.indexOf(c[0]) >= 0); }).join('') + '</optgroup>';
    if (p.ecology || showAll) {
      var allE = !p.ecy.length || showAll;
      html += '<optgroup label="Washington Ecology credits">' + ECY.filter(function (c) { return allE || p.ecy.indexOf(c[0]) >= 0; })
        .map(function (c) { return opt('ecy_' + c[0], 'ECY ' + c[0] + ' ' + c[1], allE && p.ecy.indexOf(c[0]) >= 0); }).join('') + '</optgroup>';
    }
    $('deComp').innerHTML = html;
  }

  function boot() {
    A = window.WRIApp; $ = A.$; S = A.S;
    if (!$('deSave')) return;
    fillComponents();
    $('deAll').addEventListener('change', fillComponents);
    window.addEventListener('incident:changed', fillComponents);
    $('deHot').innerHTML = HOT.map(function (h, i) { return '<button type="button" data-val="' + h[0] + '"' + (i ? '' : ' class="active"') + '>' + h[1] + '</button>'; }).join('');
    $('deMode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) showMode(b.dataset.val); });
    $('deStat').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setToggle('deStat', b.dataset.val); });
    $('deHot').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { setToggle('deHot', b.dataset.val); showMode('hotwash'); } });
    $('deNow').addEventListener('click', function () { $('deTime').value = A.localNow(); });
    $('deSave').addEventListener('click', save);
    $('deTime').value = A.localNow();
    window.addEventListener('outbox:changed', render);
    window.addEventListener('incident:changed', render);
    showMode('timeline');
  }
  window.DrillUI = { render: render };
  document.addEventListener('DOMContentLoaded', boot);
})();
