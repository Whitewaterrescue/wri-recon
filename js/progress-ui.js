/* WRI field app (offline) — Work progress (?view=progress, Cody 2026-11-19).
 *
 * A supervisor reports their work assignment: In Progress or Complete (the field's only two; Planned is the
 * Ops board's), and optionally what was recovered. Saved on the phone first; the outbox uploads to
 * wri-logistics offline_wa_progress, which writes the 214 line, the recovery balance entry (Recovery_Log) and
 * the status on the Ops board (Ops wa-progress). SCAT shoreline segments (source_ref SCAT:<segment>#R<n>) show
 * their segment and round, so the SCAT team sees the segment's progress.
 *
 * The list of work assignments comes from the incident field view (Work_Assignments) with the Field App's
 * ArcGIS sign-in, cached on the phone for no-signal use. ?wa=<assignment_id> picks one (the Field App board's
 * "Report progress" button).
 */
(function () {
  var A, $, S;
  var WA = { inc: null, rows: [], at: 0, err: '', layer: null, pick: '', status: '' };
  var DONE = { complete: 1, cancelled: 1 };

  function agolToken() {
    var raw = null;
    try { raw = localStorage.getItem('exb_auth') || sessionStorage.getItem('exb_auth'); } catch (e) { return ''; }
    try { var a = JSON.parse(raw || 'null'); if (!a || !a.token) return '';
      var exp = a.expires != null && a.expires !== '' ? new Date(a.expires).getTime() : NaN;
      return isFinite(exp) && exp - Date.now() < 120000 ? '' : String(a.token); } catch (e) { return ''; }
  }
  function agolPost(url, fields) {
    var body = new URLSearchParams(); Object.keys(fields).forEach(function (k) { body.set(k, String(fields[k])); });
    return fetch(url, { method: 'POST', body: body }).then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.error) throw new Error(j.error.message || 'ArcGIS error'); return j; });
  }

  function scat(ref) { var m = /^SCAT:([A-Za-z0-9._-]+)#R(\d+)/.exec(String(ref || '')); return m ? { segment: m[1], round: Number(m[2]) } : null; }
  function label(w) { return w.location_name || w.title || 'Work assignment'; }

  function load(force) {
    if (!S.incident) return;
    var inc = String(S.incident.incident_id), key = 'wa_list_' + inc;
    var first = WA.inc === inc ? Promise.resolve() : (WA = { inc: inc, rows: [], at: 0, err: '', layer: WA.layer, pick: WA.pick, status: WA.status },
      Store.kvGet(key).then(function (c) { if (c && WA.inc === inc && !WA.rows.length) { WA.rows = c.rows || []; WA.at = c.at || 0; draw(); } }).catch(function () {}));
    return first.then(function () {
      if (!navigator.onLine || (!force && Date.now() - WA.at < 60000 && WA.rows.length)) return draw();
      var tok = agolToken();
      if (!tok) { WA.err = 'signin'; return draw(); }
      var svc = CONFIG.INCIDENT_OPS_VIEW;
      var lid = WA.layer != null ? Promise.resolve(WA.layer) : agolPost(svc, { f: 'json', token: tok }).then(function (j) {
        var l = (j.layers || []).concat(j.tables || []).filter(function (x) { return x.name === 'Work_Assignments'; })[0];
        if (!l) throw new Error('no Work_Assignments layer');
        return (WA.layer = l.id);
      });
      return lid.then(function (id) {
        return agolPost(svc + '/' + id + '/query', { f: 'json', token: tok, returnGeometry: 'false', resultRecordCount: 500,
          where: "incident_id = '" + inc.replace(/'/g, "''") + "'",
          outFields: 'assignment_id,title,location_name,branch,division,wa_status,source_ref,priority' });
      }).then(function (j) {
        if (WA.inc !== inc) return;
        WA.rows = (j.features || []).map(function (f) { return f.attributes || {}; })
          .filter(function (w) { return w.assignment_id && !DONE[String(w.wa_status || '').toLowerCase()]; });
        WA.at = Date.now(); WA.err = '';
        Store.kvSet(key, { rows: WA.rows, at: WA.at }).catch(function () {});
        draw();
      }, function () { if (WA.inc === inc) { WA.err = 'fail'; draw(); } });
    });
  }

  function draw() {
    if (!$ || !$('pgList')) return;
    var box = $('pgList');
    if (!S.incident) { box.innerHTML = '<div class="hint">Pick the incident at the top first.</div>'; return; }
    var rows = WA.rows.slice().sort(function (a, b) {
      return String(a.division || a.branch || '').localeCompare(String(b.division || b.branch || '')) || label(a).localeCompare(label(b));
    });
    var note = WA.err === 'signin' ? '<div class="hint">Sign in to the Field App (ArcGIS) to load the work assignments; the last list on this phone is shown.</div>'
      : WA.err === 'fail' ? '<div class="hint">Could not load the work assignments just now; the last list on this phone is shown.</div>' : '';
    box.innerHTML = note + (rows.length ? rows.map(function (w) {
      var sc = scat(w.source_ref), on = WA.pick === w.assignment_id;
      return '<button type="button" class="pg-wa' + (on ? ' on' : '') + '" data-id="' + A.esc(w.assignment_id) + '">' +
        '<span class="pg-t">' + A.esc(label(w)) + '</span>' +
        '<span class="pg-m">' + A.esc([w.division || w.branch, sc ? 'SCAT segment ' + sc.segment + ' · round ' + sc.round : '',
          String(w.wa_status || 'planned').replace('_', ' ')].filter(Boolean).join(' · ')) + '</span></button>';
    }).join('') : '<div class="hint">' + (WA.at ? 'No open work assignments on this incident.' : 'Loading the work assignments…') + '</div>');
    [].forEach.call(box.querySelectorAll('.pg-wa'), function (b) {
      b.onclick = function () { WA.pick = b.dataset.id; draw(); };
    });
    [].forEach.call($('pgStatus').children, function (b) { b.classList.toggle('active', b.dataset.val === WA.status); });
    renderMine();
  }

  function save() {
    if (!S.incident) return A.toast('Pick the incident at the top first.');
    var w = WA.rows.filter(function (x) { return x.assignment_id === WA.pick; })[0];
    if (!w) return A.toast('Pick your work assignment.');
    if (!WA.status) return A.toast('In Progress or Complete?');
    var who = $('pgName').value.trim();
    if (!who) return A.toast('Enter your name.');
    var vol = $('pgVol').value.trim(), rec = null;
    if (vol !== '') {
      if (!(Number(vol) >= 0)) return A.toast('The recovered volume must be a number.');
      if (Number(vol) > 0) rec = { volume: Number(vol), unit: $('pgUnit').value, material: $('pgMat').value };
    }
    A.lsSet('wri_recon_name', who);
    var btn = $('pgSave');
    A.busy(btn, true, 'Saving…');
    Outbox.enqueue({ recon_id: A.uuid(), kind: 'progress', incident: S.incident, fields: {
      assignment_id: w.assignment_id, status: WA.status, person: who, position: $('pgPos').value.trim(), at: Date.now(),
      note: $('pgNote').value.trim(), wa_label: label(w), division: w.division || w.branch || '', location: w.location_name || '',
      source_ref: w.source_ref || '', recovered: rec } }, []).then(function () {
      A.busy(btn, false);
      A.toast('Saved.' + (navigator.onLine ? ' Uploading…' : ' No signal: it uploads when you’re back in coverage.'));
      $('pgVol').value = ''; $('pgNote').value = ''; WA.status = '';
      try { navigator.serviceWorker && navigator.serviceWorker.ready.then(function (r) { return r.sync && r.sync.register('wri-recon-outbox'); }).catch(function () {}); } catch (e) {}
      draw();
    }, function (e) { A.busy(btn, false); A.toast('Could not save on this phone: ' + e.message, 8000); });
  }

  function renderMine() {
    Outbox.list().then(function (rs) {
      var inc = S.incident && S.incident.incident_id;
      var mine = rs.filter(function (r) { return r.kind === 'progress' && (!inc || (r.incident && r.incident.incident_id === inc)); })
        .sort(function (a, b) { return ((b.fields || {}).at || b.created_at) - ((a.fields || {}).at || a.created_at); }).slice(0, 30);
      $('pgMine').innerHTML = mine.length ? mine.map(function (r) {
        var f = r.fields || {}, t = new Date(f.at || r.created_at), res = r.result || {};
        var ops = res.ops || {};
        var st = r.status === 'sent' ? (ops.ok === false ? '<span class="s red">Uploaded; Ops: ' + A.esc(ops.message || ops.error || 'not changed') + '</span>'
                                                         : '<span class="s green">Uploaded</span>')
          : r.status === 'failed' ? '<span class="s red">' + A.esc(r.last_error || 'Could not upload') + '</span>'
          : r.status === 'needs_pin' ? '<span class="s red">Waiting for the incident PIN</span>' : '<span class="s amber">Waiting to upload</span>';
        return '<div class="item"><div class="t">' + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + A.esc(A.recordTitle(r)) + '</div><div>' + st + '</div></div>';
      }).join('') : '<div class="hint">No progress reports on this phone yet.</div>';
    });
  }

  function render() {
    if (!$ || !$('pgList')) return;
    if (!$('pgName').value) $('pgName').value = A.lsGet('wri_recon_name') || '';
    $('pgNames').innerHTML = ((S.cfg && S.cfg.staff) || []).map(function (n) { return '<option value="' + A.esc(n) + '">'; }).join('');
    draw();
    load(false);
  }

  function boot() {
    A = window.WRIApp; $ = A.$; S = A.S;
    if (!$('pgSave')) return;
    var m = /[?&]wa=([^&#]+)/.exec(location.search);
    if (m) WA.pick = decodeURIComponent(m[1]);
    $('pgStatus').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { WA.status = b.dataset.val; draw(); } });
    $('pgSave').addEventListener('click', save);
    $('pgReload').addEventListener('click', function () { load(true); });
    window.addEventListener('outbox:changed', renderMine);
    window.addEventListener('incident:changed', function () { WA.inc = null; render(); });
    render();
  }
  window.ProgressUI = { render: render };
  document.addEventListener('DOMContentLoaded', boot);
})();
