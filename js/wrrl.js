/* WRI Field Forms — the WRRL catalog on the phone, for the Request page's "Find in the WRRL" (2026-11-13, Cody).
 *
 * Replaces the Ops "Resource Request V2" AI Search (which only showed Claude the first 80 rows and needed signal).
 * The whole WRRLdataall list (~11.8k items, ~160 KB over the wire) is kept in IndexedDB and searched here, so it
 * works with no signal. With signal it asks Logistics at most once a day (offline_wrrl, PIN-gated); the server
 * answers {unchanged:true} while the version the phone holds is current.
 * rows: [wrrl_id, organization_code, resource_kind, resource_kindtype, identification, specification]
 */
(function () {
  var KEY = 'wrrl_catalog', DAY = 864e5;
  var W = { rows: null, idx: null, version: '', at: 0, loading: null, err: '' };

  function index(rows) {
    return rows.map(function (r) { return (r[4] + ' ' + r[2] + ' ' + r[3] + ' ' + r[5] + ' ' + r[1] + ' ' + r[0]).toLowerCase(); });
  }
  function load() {
    if (W.rows) return Promise.resolve(W);
    return Store.kvGet(KEY).then(function (c) {
      if (c && c.rows && !W.rows) { W.rows = c.rows; W.idx = index(c.rows); W.version = c.version || ''; W.at = c.at || 0; }
      return W;
    }).catch(function () { return W; });
  }
  // with signal and the incident PIN on the phone: fetch when the copy is missing or a day old
  function refresh(incidentId, force) {
    if (W.loading) return W.loading;
    W.loading = load().then(function () {
      if (!navigator.onLine || !incidentId || (!force && W.rows && Date.now() - W.at < DAY)) return W;
      return Promise.all([Outbox.pinFor(incidentId), Store.deviceId()]).then(function (a) {
        if (!a[0]) { W.err = W.rows ? '' : 'pin'; return W; }
        return Api.post('offline_wrrl', { pin: a[0], device: a[1], incident_id: incidentId, version: W.rows ? W.version : '' },
          90000, CONFIG.LOGISTICS_API).then(function (d) {
          if (!d || !d.version) return W;
          if (d.rows) { W.rows = d.rows; W.idx = index(d.rows); }
          if (!W.rows) return W;
          W.version = d.version; W.at = Date.now(); W.err = '';
          return Store.kvSet(KEY, { rows: W.rows, version: W.version, at: W.at }).then(function () { return W; });
        });
      });
    }).catch(function (e) { W.err = W.rows ? '' : String((e && e.message) || e || 'error'); return W; })
      .then(function (w) { W.loading = null; return w; });
    return W.loading;
  }
  // every word must appear somewhere; the name and kind weigh most. One line per distinct item + organization.
  function search(q, max) {
    if (!W.rows) return { items: [], total: 0 };
    var toks = String(q || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    if (!toks.length) return { items: [], total: 0 };
    var hits = [];
    for (var i = 0; i < W.idx.length; i++) {
      var s = W.idx[i], ok = true;
      for (var t = 0; t < toks.length; t++) if (s.indexOf(toks[t]) < 0) { ok = false; break; }
      if (!ok) continue;
      var r = W.rows[i], ident = r[4].toLowerCase(), kind = r[2].toLowerCase(), score = 0;
      toks.forEach(function (tk) {
        if (ident.indexOf(tk) >= 0) score += 3;
        if (kind.indexOf(tk) >= 0) score += 2;
        if (r[1].toLowerCase() === tk) score += 4;   // an organization code typed on purpose
        if (r[0] === tk) score += 10;                 // a WRRL id
      });
      hits.push([score, i]);
    }
    hits.sort(function (a, b) { return b[0] - a[0] || (W.rows[a[1]][4] < W.rows[b[1]][4] ? -1 : 1); });
    var seen = {}, out = [];
    for (var h = 0; h < hits.length && out.length < (max || 15); h++) {
      var x = W.rows[hits[h][1]], k = [x[1], x[2], x[4], x[5]].join('|').toLowerCase();
      if (seen[k]) continue;
      seen[k] = 1;
      out.push({ id: x[0], org: x[1], kind: x[2], type: x[3], ident: x[4], spec: x[5] });
    }
    return { items: out, total: hits.length };
  }
  window.WRRL = {
    load: load, refresh: refresh, search: search,
    info: function () { return { count: W.rows ? W.rows.length : 0, at: W.at, err: W.err, loading: !!W.loading }; }
  };
})();
