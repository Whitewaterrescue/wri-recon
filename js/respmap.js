/* WRI Field Forms — the incident RESPONSE MAP on the Recon location step (2026-11-13, Cody).
 *
 * The Recon GAS page showed the response web map; Field Forms showed only Leaflet imagery. Now, with signal and the
 * Field App's ArcGIS sign-in on this phone (exb_auth, same origin), the location step shows the response map of the
 * incident picked at Field App login (wri_incident_choice / the incident selector here):
 *   1. the incident's web map from the WRI incident registry (WRI_Incident_Ops_field_view/0 webmap_id), else the
 *      Field App's own incident map (CONFIG.RESPONSE_WEBMAP);
 *   2. every layer with a project-style filter rewritten to the incident's project_key, exactly as the Field App's
 *      incident picker does (wri-exb-widgets-src incident-scope rewriteFilter): two incidents on one client map each
 *      see their own data;
 *   3. drone orthos hidden on phones (the old Recon page did the same: imagery tiles swamp phone data).
 * No signal, no sign-in, or the map engine / web map fails (25 s watchdog) -> the caller keeps the Leaflet imagery map.
 *
 * RespMap.start({container, incident, onTap}) -> Promise<adapter | null>
 *   adapter: { kind:'response', setPin(lat, lon, center), clearPin(), invalidate(), setIncident(inc) -> Promise }
 */
(function () {
  var JS = 'https://js.arcgis.com/4.29/', CSS = 'https://js.arcgis.com/4.29/esri/themes/dark/main.css';
  var REGISTRY = function () { return CONFIG.INCIDENT_OPS_VIEW + '/0'; };
  var PROJECT_FILTER_RE = /\b(ProjectName|project_name|incident_id|IncidentID|project|Project)(\s*(?:=|LIKE)\s*)'([^']*)'/gi;
  var sdk = null, mods = null;

  function auth() {
    var raw = null;
    try { raw = localStorage.getItem('exb_auth') || sessionStorage.getItem('exb_auth'); } catch (e) { return null; }
    try {
      var a = JSON.parse(raw || 'null'); if (!a || !a.token) return null;
      var exp = a.expires != null && a.expires !== '' ? new Date(a.expires).getTime() : NaN;
      if (isFinite(exp) && exp - Date.now() < 300000) return null;   // under 5 min left: Leaflet, not a half-loaded map
      return { token: String(a.token), expires: isFinite(exp) ? exp : Date.now() + 3600e3, user: String(a.userId || a.username || '') };
    } catch (e) { return null; }
  }
  function loadSdk() {
    if (mods) return Promise.resolve(mods);
    if (sdk) return sdk;
    sdk = new Promise(function (res, rej) {
      if (!document.getElementById('respMapCss')) {
        var l = document.createElement('link'); l.id = 'respMapCss'; l.rel = 'stylesheet'; l.href = CSS; document.head.appendChild(l);
      }
      var s = document.createElement('script'); s.src = JS; s.async = true;
      s.onload = function () {
        if (typeof window.require !== 'function') return rej(new Error('map engine did not load'));
        window.require(['esri/WebMap', 'esri/views/MapView', 'esri/Graphic', 'esri/identity/IdentityManager', 'esri/config'],
          function (WebMap, MapView, Graphic, esriId, esriConfig) {
            esriConfig.portalUrl = CONFIG.PORTAL_URL;
            mods = { WebMap: WebMap, MapView: MapView, Graphic: Graphic, esriId: esriId };
            // never show the SDK's own sign-in dialog (a layer the account can't open): close it, the layer is skipped
            esriId.on('dialog-create', function () {
              try { if (esriId.dialog) { esriId.dialog.open = false; esriId.dialog.visible = false; } } catch (e) {}
            });
            res(mods);
          }, function (e) { rej(e); });
      };
      s.onerror = function () { rej(new Error('map engine did not load')); };
      document.head.appendChild(s);
    }).catch(function (e) { sdk = null; throw e; });
    return sdk;
  }
  function registerToken(a) {
    // both the generic AGOL host and the org portal: the item loads from the portal, its layers from services*.arcgis.com
    ['https://www.arcgis.com/sharing/rest', CONFIG.PORTAL_URL + '/sharing/rest'].forEach(function (server) {
      var o = { server: server, token: a.token, expires: a.expires, ssl: true };
      if (a.user) o.userId = a.user;
      mods.esriId.registerToken(o);
    });
  }
  // the Field App's token must still be good: a stale one makes the map engine pop its own ArcGIS sign-in dialog
  function tokenOk(token) {
    return fetch(CONFIG.PORTAL_URL + '/sharing/rest/community/self', { method: 'POST', body: new URLSearchParams({ f: 'json', token: token }) })
      .then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.username) ? String(j.username) : ''; })
      .catch(function () { return ''; });
  }
  function registryRow(incidentId, token) {
    var body = new URLSearchParams({ f: 'json', token: token, returnGeometry: 'false', outFields: 'incident_id,project_key,webmap_id',
      where: "incident_id = '" + String(incidentId).replace(/'/g, "''") + "'" });
    return fetch(REGISTRY() + '/query', { method: 'POST', body: body }).then(function (r) { return r.json(); })
      .then(function (j) { var f = j && j.features && j.features[0]; return f ? f.attributes : null; })
      .catch(function () { return null; });
  }
  function rewrite(map, value) {
    var v = String(value).replace(/'/g, "''"), n = 0;
    map.allLayers.forEach(function (l) {
      var de = l && l.definitionExpression;
      if (typeof de !== 'string' || !de) return;
      PROJECT_FILTER_RE.lastIndex = 0;
      if (!PROJECT_FILTER_RE.test(de)) return;
      PROJECT_FILTER_RE.lastIndex = 0;
      var nd = de.replace(PROJECT_FILTER_RE, function (m, field, op) { return field + op + "'" + v + "'"; });
      if (nd !== de) { try { l.definitionExpression = nd; n++; } catch (e) {} }
    });
    return n;
  }
  function isPhone() {
    try { return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 820; } catch (e) { return false; }
  }
  function hideOrthos(map) {
    if (!isPhone()) return;
    var GROUP_RE = /overflight|ortho|drone/i, TITLE_RE = /^\d{8}[_ -]|^RM-?\d/i, TYPES = { 'imagery-tile': 1, imagery: 1, kml: 1 };
    (function walk(layers) {
      if (!layers) return;
      layers.forEach(function (l) {
        var t = l.title || '';
        if (l.type === 'group') { if (GROUP_RE.test(t)) l.visible = false; else walk(l.layers); }
        else if (TYPES[l.type] || GROUP_RE.test(t) || TITLE_RE.test(t)) l.visible = false;
      });
    })(map.layers);
  }
  function loadWebMap(id) {
    var wm = new mods.WebMap({ portalItem: { id: id, portal: { url: CONFIG.PORTAL_URL } } });
    return wm.load().then(function () { return wm; });
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (res, rej) { setTimeout(function () { rej(new Error('the response map timed out')); }, ms); })]);
  }

  function start(o) {
    var a = auth();
    if (!navigator.onLine || !a || !o.incident || !CONFIG.RESPONSE_WEBMAP) return Promise.resolve(null);
    var st = { view: null, map: null, mapId: '', project: '', pin: null };
    function resolveMap(inc) {
      return registryRow(inc.incident_id, a.token).then(function (row) {
        return { id: (row && row.webmap_id) || CONFIG.RESPONSE_WEBMAP, project: (row && row.project_key) || inc.project_key || '' };
      });
    }
    function show(target) {
      var p = target.id === st.mapId && st.map ? Promise.resolve(st.map) : loadWebMap(target.id);
      return p.then(function (wm) {
        if (target.project) rewrite(wm, target.project);
        hideOrthos(wm);
        var fresh = wm !== st.map;
        st.map = wm; st.mapId = target.id; st.project = target.project;
        if (!st.view) {
          st.view = new mods.MapView({ container: o.container, map: wm, popupEnabled: false, ui: { components: ['zoom', 'attribution'] } });
          st.view.on('click', function (e) { if (e.mapPoint) o.onTap(e.mapPoint.latitude, e.mapPoint.longitude); });
        } else if (fresh) {
          st.view.map = wm;
          if (!st.pin && wm.initialViewProperties && wm.initialViewProperties.viewpoint) st.view.goTo(wm.initialViewProperties.viewpoint).catch(function () {});
        }
        return st.view.when();
      });
    }
    var adapter = {
      kind: 'response',
      setPin: function (lat, lon, center) {
        st.pin = [lat, lon];
        if (!st.view) return;
        st.view.graphics.removeAll();
        st.view.graphics.add(new mods.Graphic({ geometry: { type: 'point', longitude: lon, latitude: lat },
          symbol: { type: 'simple-marker', color: '#EC2329', size: 14, outline: { color: '#ffffff', width: 2 } } }));
        if (center) st.view.goTo({ center: [lon, lat], zoom: Math.max(st.view.zoom || 0, 15) }).catch(function () {});
      },
      clearPin: function () { st.pin = null; if (st.view) st.view.graphics.removeAll(); },
      invalidate: function () {},   // the MapView follows its container's size by itself
      // the incident selector changed: same web map -> re-filter in place; another map -> load it
      setIncident: function (inc) {
        if (!inc) return Promise.resolve();
        return resolveMap(inc).then(function (t) { return withTimeout(show(t), 25000); })
          .then(function () { if (st.pin) adapter.setPin(st.pin[0], st.pin[1], false); });
      },
      refreshRecon: function () {
        try { st.map.allLayers.forEach(function (l) { if (/recon/i.test(l.title || '') && typeof l.refresh === 'function') l.refresh(); }); } catch (e) {}
      }
    };
    return withTimeout(tokenOk(a.token).then(function (user) {
      if (!user) throw new Error('the ArcGIS sign-in on this phone has expired');
      if (!a.user) a.user = user;
      return loadSdk();
    }).then(function () {
      registerToken(a);
      return resolveMap(o.incident);
    }).then(show), 25000).then(function () { return adapter; }, function (e) {
      try { if (st.view) st.view.destroy(); } catch (x) {}
      try { document.getElementById(o.container).innerHTML = ''; } catch (x) {}
      console.warn('[Recon map] response map unavailable, using imagery:', e && e.message);
      return null;
    });
  }
  window.RespMap = { start: start };
})();
