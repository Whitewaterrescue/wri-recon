/* WRI Field Forms — ?embed=hasp: the Field App's HASP page signs one plan in an in-panel frame
 * (2026-11-05, batch 11). Before this, Acknowledge opened the HASP web app in a new tab: the tech
 * saw a spinner, never knew whether they had signed, and nothing ticked.
 *
 *   /wri-recon/?embed=hasp&hasp=<objectId>&incident=<id>&name=<checked-in name>&project=<key>#hasp
 *
 * Signing is the HASP tab's own sign-off (forms-ui.js): saved on the phone first, sent by the outbox
 * with the incident PIN (HASP V5 offline_ack, idempotent by the record id), so it works with no
 * signal. This file only opens that one plan and tells the Field App how the sign-off is doing:
 *   parent.postMessage({ type: 'wri-hasp', v: 1, status, haspId, incidentId, name, at, sentAt, error, id }, origin)
 *   status: ready (form shown) | queued (saved on the phone) | needs_pin | sent | failed
 * and keeps the same in localStorage.wri_hasp_acks['<incidentId>|<haspId>'] (same origin as the
 * Field App, so the HASP page and the Checklist read it after a reload).
 */
(function () {
  var q; try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get('embed') !== 'hasp') return;
  var HASP_ID = String(q.get('hasp') || '').replace(/[^0-9]/g, '').slice(0, 12);
  var NAME = String(q.get('name') || '').trim().slice(0, 120);
  var PROJECT = String(q.get('project') || '').trim().slice(0, 120);
  var INC = String(q.get('incident') || '').trim().slice(0, 64);
  var ACKS = 'wri_hasp_acks';
  CONFIG.TABS = ['hasp'];   // before forms-ui boots: only the HASP tab, and its list loads
  // the checked-in person is the one holding the phone (same rule as ?embed=214)
  try { if (NAME) localStorage.setItem('wri_recon_name', NAME); } catch (e) {}

  var A, $, last = '', box;

  function incId() { return String((A && A.S.incident && A.S.incident.incident_id) || INC || ''); }
  function sameName(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
  function mine(rs) {   // this plan's newest sign-off on this phone (by the checked-in name when there is one)
    // 2026-11-06 (batch 13): or by whoever signed after "Not you?" (the sign-off keeps their name in wri_recon_name)
    var signer = ''; try { signer = localStorage.getItem('wri_recon_name') || ''; } catch (e) {}
    return (rs || []).filter(function (r) {
      return r.kind === 'hasp' && r.fields && String(r.fields.haspId) === HASP_ID &&
        (!NAME || sameName(r.fields.employeeName, NAME) || (signer && sameName(r.fields.employeeName, signer)));
    }).sort(function (x, y) { return y.created_at - x.created_at; })[0] || null;
  }
  function post(m) {
    m.type = 'wri-hasp'; m.v = 1; m.haspId = HASP_ID; m.incidentId = m.incidentId || incId();
    var key = m.status + '|' + (m.error || '') + '|' + (m.id || '') + '|' + navigator.onLine;
    try {   // the Field App reads this after a reload (HASP page + Checklist)
      if (m.status !== 'ready' && m.incidentId && HASP_ID) {
        var all = JSON.parse(localStorage.getItem(ACKS) || '{}') || {};
        all[m.incidentId + '|' + HASP_ID] = { name: m.name, at: m.at, status: m.status, sentAt: m.sentAt || 0, error: m.error || '', id: m.id || '' };
        localStorage.setItem(ACKS, JSON.stringify(all));
      }
    } catch (e) {}
    if (window.parent !== window) try { window.parent.postMessage(m, location.origin); } catch (e) {}
    if (key !== last) { last = key; show(m); }
  }
  function statusOf(r) {
    return { status: r.status === 'sent' ? 'sent' : r.status === 'needs_pin' ? 'needs_pin' : r.status === 'failed' ? 'failed' : 'queued',
      name: r.fields.employeeName, at: Number(r.fields.ack_time) || r.created_at, sentAt: r.sent_at || 0, id: r.recon_id,
      incidentId: String((r.incident && r.incident.incident_id) || incId()),
      error: r.status === 'failed' || r.status === 'needs_pin' ? String(r.last_error || '') : '' };
  }
  function report() {
    return Outbox.list().then(function (rs) {
      var r = mine(rs);
      if (r) post(statusOf(r)); else if (!last) post({ status: 'ready', name: NAME, at: 0 });
    }).catch(function () {});
  }

  function fmt(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function show(m) {   // the result card over the (hidden) form; 'ready' leaves the form showing
    if (!box) return;
    if (m.status === 'ready') { box.classList.add('hidden'); return; }
    $('haspDetail').classList.add('hidden');
    var h = '';
    if (m.status === 'sent') h = '<div class="he-ok">Signed ' + A.esc(fmt(m.at)) + ' as ' + A.esc(m.name) + '</div><p>The Safety Officer sees your sign-off. It is in your 214 too.</p>';
    else if (m.status === 'queued') h = '<div class="he-wait">Saved on this phone</div><p>' + (navigator.onLine ? 'Sending now…' : 'It sends when you have signal.') + '</p>';
    else if (m.status === 'needs_pin') h = '<div class="he-wait">Saved on this phone</div><p>It sends once the incident PIN is entered.</p>' +
      '<button class="btn btn-save wide" id="hePin" type="button">Enter the incident PIN</button>';
    else h = '<div class="he-bad">Not signed yet</div><p>' + A.esc(m.error || 'The sign-off could not be sent.') + '</p>' +
      '<button class="btn btn-save wide" id="heRetry" type="button">Try again</button>';
    box.innerHTML = h; box.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', function () {   // after forms-ui's boot (this file loads after it)
    A = window.WRIApp; $ = A.$;
    document.body.classList.add('embed', 'embed-hasp');
    box = document.createElement('div'); box.id = 'haspEmbedResult'; box.className = 'he-card hidden';
    $('haspDetail').parentNode.insertBefore(box, $('haspDetail'));
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.id === 'hePin') { var bn = $('banner'); if (bn && bn.dataset.act === 'pin') bn.click(); else A.toast('Enter the PIN when it asks.'); }
      if (b.id === 'heRetry') {
        A.busy(b, true, 'Sending…');
        Outbox.list().then(function (rs) {
          var r = mine(rs);
          if (!r) { last = ''; box.classList.add('hidden'); open(); return; }
          return Outbox.retry(r.recon_id, A.S.incident || null);
        }).then(function () { last = ''; return report(); }, function () { last = ''; return report(); });
      }
    });
    function open() {
      var stub = { objectId: Number(HASP_ID), project_name: PROJECT || 'HASP', acked: [] };
      window.WRIForms.openHasp(HASP_ID, stub);
      // the HASP page already showed the plan: say so here instead of the list's hint
      $('haspHint').textContent = 'Signing the plan you read on the HASP page' + (PROJECT ? ' (' + PROJECT + ')' : '') + '.';
    }
    if (!HASP_ID) { $('haspHint').textContent = 'No HASP picked. Close this and open the HASP page again.'; post({ status: 'failed', name: NAME, at: 0, error: 'No HASP picked.' }); return; }
    Outbox.list().then(function (rs) { if (!mine(rs)) open(); }).catch(open).then(report);
    window.addEventListener('outbox:changed', report);
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'outbox:changed') report(); });
    window.addEventListener('online', report); window.addEventListener('offline', report);
    window.addEventListener('message', function (e) {   // the HASP page asks again (reopened / back from the background)
      if (e.origin !== location.origin || !e.data || e.data.type !== 'wri-hasp' || e.data.action !== 'report') return;
      last = ''; report();
      try { if (navigator.onLine) A.kick(); } catch (x) {}
    });
  });
  window.WRIHaspEmbed = { v: 1 };   // the Field App checks this to spot an old cached copy of Field Forms
})();
