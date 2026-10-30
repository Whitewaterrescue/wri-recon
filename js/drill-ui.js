/* WRI field app (offline) — the Drill Eval tab (2026-10-30).
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

  function boot() {
    A = window.WRIApp; $ = A.$; S = A.S;
    if (!$('deSave')) return;
    $('deComp').innerHTML = '<option value="">Select…</option>' + COMPONENTS.map(function (c) { return '<option value="' + c[0] + '">' + A.esc(c[1]) + '</option>'; }).join('');
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
