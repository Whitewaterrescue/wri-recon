/* WRI Field Forms — read where a drone photo was taken, from the first ~128 KB of the file.
 *
 * DJI writes everything we need into the JPEG header (measured on M4T frames, 2026-10-26):
 *   XMP drone-dji:GpsLatitude/GpsLongitude  the aircraft
 *   XMP drone-dji:LRFTargetLat/LRFTargetLon the laser rangefinder's ground point (M4T/M30T/M3T),
 *                                            i.e. what the camera was actually aimed at
 *   XMP RelativeAltitude, GimbalPitch/Yaw, DroneModel, DroneSerialNumber
 *   EXIF GPS + DateTimeOriginal              fallback for phones and older drones
 *   EXIF IFD1                                a ~20 KB preview JPEG, so a 100-photo list never decodes a full frame
 *
 * Placement: rangefinder target when it measured one, else the aircraft position. No computed
 * angle/altitude projection: it is too imprecise to trust (Cody, pano annotations 2026-09-27).
 * Invalid GPS: DJI writes ~0,0 with GpsStatus="Invalid" when it has no fix.
 *
 * Pure functions, no DOM: also runs under Node for tests (module.exports).
 */
(function (g) {
  var HEAD_BYTES = 131072;

  function okLatLon(lat, lon) {
    return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01);
  }

  function xmpNum(text, tag) {
    var m = new RegExp('drone-dji:' + tag + '\\s*=\\s*"([^"]*)"').exec(text) ||
      new RegExp('<drone-dji:' + tag + '>([^<]*)<').exec(text);
    if (!m) return null;
    var v = parseFloat(m[1]);
    return isFinite(v) ? v : null;
  }
  function xmpStr(text, tag) {
    var m = new RegExp('drone-dji:' + tag + '\\s*=\\s*"([^"]*)"').exec(text) ||
      new RegExp('<drone-dji:' + tag + '>([^<]*)<').exec(text);
    return m ? m[1] : '';
  }

  /** EXIF (TIFF) walk: GPS, DateTimeOriginal, IFD1 thumbnail offset/length (file offsets). */
  function readExif(bytes) {
    var out = {};
    // find the APP1 Exif segment
    var i = 2, n = bytes.length, tiff = -1;
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return out;
    while (i + 4 < n && bytes[i] === 0xFF) {
      var marker = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xE1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) { tiff = i + 10; break; }
      if (marker === 0xDA) break;
      i += 2 + len;
    }
    if (tiff < 0 || tiff + 8 > n) return out;
    var le = bytes[tiff] === 0x49;
    function u16(o) { return le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]; }
    function u32(o) { return le ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) + bytes[o + 3] * 16777216
                                : bytes[o] * 16777216 + ((bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]); }
    function entries(off) {
      var a = tiff + off; if (a + 2 > n) return { list: [], next: 0 };
      var c = u16(a), list = [];
      for (var k = 0; k < c; k++) {
        var e = a + 2 + k * 12; if (e + 12 > n) break;
        list.push({ tag: u16(e), type: u16(e + 2), count: u32(e + 4), valOff: e + 8 });
      }
      var nx = a + 2 + c * 12;
      return { list: list, next: nx + 4 <= n ? u32(nx) : 0 };
    }
    function find(list, tag) { for (var k = 0; k < list.length; k++) if (list[k].tag === tag) return list[k]; return null; }
    function rationals(e) {   // type 5, count 3 -> degrees
      if (!e) return null;
      var p = tiff + u32(e.valOff), v = [];
      for (var k = 0; k < e.count; k++) { var d = u32(p + 8 * k + 4); v.push(d ? u32(p + 8 * k) / d : 0); }
      return v;
    }
    function ascii(e) {
      if (!e) return '';
      var p = e.count <= 4 ? e.valOff : tiff + u32(e.valOff), s = '';
      for (var k = 0; k < e.count && p + k < n; k++) { var ch = bytes[p + k]; if (!ch) break; s += String.fromCharCode(ch); }
      return s;
    }
    var ifd0 = entries(u32(tiff + 4));
    var exifPtr = find(ifd0.list, 0x8769), gpsPtr = find(ifd0.list, 0x8825);
    if (exifPtr) {
      var ex = entries(u32(exifPtr.valOff));
      out.datetime = ascii(find(ex.list, 0x9003)) || ascii(find(ifd0.list, 0x0132));
    }
    if (gpsPtr) {
      var gps = entries(u32(gpsPtr.valOff));
      var la = rationals(find(gps.list, 2)), lo = rationals(find(gps.list, 4));
      var laRef = ascii(find(gps.list, 1)), loRef = ascii(find(gps.list, 3));
      if (la && lo && la.length === 3 && lo.length === 3) {
        var lat = la[0] + la[1] / 60 + la[2] / 3600, lon = lo[0] + lo[1] / 60 + lo[2] / 3600;
        if (laRef === 'S') lat = -lat;
        if (loRef === 'W') lon = -lon;
        out.lat = lat; out.lon = lon;
      }
    }
    if (ifd0.next) {
      var ifd1 = entries(ifd0.next);
      var to = find(ifd1.list, 0x0201), tl = find(ifd1.list, 0x0202);
      if (to && tl) { out.thumbOff = tiff + u32(to.valOff); out.thumbLen = u32(tl.valOff); }
    }
    return out;
  }

  /** "2026:10:21 09:15:14" or DJI_20261021091514_ file name -> epoch ms (phone-local time, as DJI writes it). */
  function parseTime(exifDt, name) {
    var m = /(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(exifDt || '');
    if (!m) m = /DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i.exec(name || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  /**
   * bytes: Uint8Array of the file's first HEAD_BYTES. Returns
   * { lat, lon, placement: 'target'|'drone'|'none', drone_lat, drone_lon, target_dist_m,
   *   rel_alt, pitch, yaw, model, sn, taken, thumbOff, thumbLen, dji }
   */
  function parse(bytes, name) {
    var text = '';
    // the XMP packet is plain ASCII inside the header; decode only that slice
    var CH = 0x8000;
    for (var k = 0; k < bytes.length; k += CH) text += String.fromCharCode.apply(null, bytes.subarray(k, Math.min(bytes.length, k + CH)));
    var x0 = text.indexOf('<x:xmpmeta'), x1 = text.indexOf('</x:xmpmeta>');
    var xmp = x0 >= 0 ? text.slice(x0, x1 > x0 ? x1 : x0 + 20000) : '';
    var ex = readExif(bytes);
    var r = { dji: /drone-dji:/.test(xmp), placement: 'none', lat: null, lon: null };

    var dLat = xmpNum(xmp, 'GpsLatitude'), dLon = xmpNum(xmp, 'GpsLongitude');
    if (dLon == null) dLon = xmpNum(xmp, 'GpsLongtitude');   // some DJI firmware spells it this way
    var gpsBad = /Invalid/i.test(xmpStr(xmp, 'GpsStatus'));
    if (gpsBad || !okLatLon(dLat, dLon)) { dLat = null; dLon = null; }
    if (dLat == null && okLatLon(ex.lat, ex.lon) && !gpsBad) { dLat = ex.lat; dLon = ex.lon; }
    r.drone_lat = dLat; r.drone_lon = dLon;

    var tLat = xmpNum(xmp, 'LRFTargetLat'), tLon = xmpNum(xmp, 'LRFTargetLon'), tDist = xmpNum(xmp, 'LRFTargetDistance');
    var lrfOk = /Normal/i.test(xmpStr(xmp, 'LRFStatus')) && okLatLon(tLat, tLon) && dLat != null && tDist > 0 &&
      distanceM(dLat, dLon, tLat, tLon) < 3000;   // a rangefinder fix kilometres from the aircraft is junk
    if (lrfOk) { r.lat = tLat; r.lon = tLon; r.placement = 'target'; r.target_dist_m = Math.round(tDist); }
    else if (dLat != null) { r.lat = dLat; r.lon = dLon; r.placement = r.dji ? 'drone' : 'gps'; }

    r.rel_alt = xmpNum(xmp, 'RelativeAltitude');
    r.pitch = xmpNum(xmp, 'GimbalPitchDegree');
    r.yaw = xmpNum(xmp, 'GimbalYawDegree');
    r.model = xmpStr(xmp, 'DroneModel') || '';
    r.sn = xmpStr(xmp, 'DroneSerialNumber') || '';
    r.taken = parseTime(ex.datetime, name);
    if (ex.thumbOff && ex.thumbLen && ex.thumbOff + ex.thumbLen <= bytes.length) { r.thumbOff = ex.thumbOff; r.thumbLen = ex.thumbLen; }
    return r;
  }

  function distanceM(lat1, lon1, lat2, lon2) {
    var R = 6371008.8, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /**
   * Group photos shot together: sorted by time, a photo joins the previous group when it is
   * within GAP_S seconds AND GAP_M metres of that group's last photo. Photos with no location
   * form their own group at the end. items: [{meta:{lat,lon,taken}, ...}] -> [[item,...],...]
   */
  var GAP_S = 60, GAP_M = 75;
  function group(items) {
    var located = items.filter(function (it) { return it.meta && it.meta.lat != null; });
    var lost = items.filter(function (it) { return !it.meta || it.meta.lat == null; });
    located.sort(function (a, b) { return (a.meta.taken || 0) - (b.meta.taken || 0) || String(a.name).localeCompare(String(b.name)); });
    var groups = [], cur = null, last = null;
    located.forEach(function (it) {
      var m = it.meta;
      var near = last && distanceM(last.lat, last.lon, m.lat, m.lon) <= GAP_M;
      var soon = last && (m.taken == null || last.taken == null || Math.abs(m.taken - last.taken) <= GAP_S * 1000);
      if (!cur || !near || !soon) { cur = []; groups.push(cur); }
      cur.push(it); last = m;
    });
    if (lost.length) groups.push(lost);
    return groups;
  }

  /** Centre of a group's located photos. */
  function centroid(list) {
    var la = 0, lo = 0, c = 0;
    list.forEach(function (it) { if (it.meta && it.meta.lat != null) { la += it.meta.lat; lo += it.meta.lon; c++; } });
    return c ? { lat: la / c, lon: lo / c } : null;
  }

  /** Compact metadata for the attachment's `keywords` (AGOL caps it at 2048 chars). */
  function keywords(meta, name, source) {
    var o = { src: source || 'sd', file: String(name || '').slice(0, 60) };
    if (meta) {
      if (meta.taken) o.t = new Date(meta.taken).toISOString().slice(0, 19);
      if (meta.lat != null) { o.lat = +meta.lat.toFixed(7); o.lon = +meta.lon.toFixed(7); }
      o.place = meta.placement;
      if (meta.drone_lat != null) { o.dlat = +meta.drone_lat.toFixed(7); o.dlon = +meta.drone_lon.toFixed(7); }
      if (meta.target_dist_m != null) o.lrf_m = meta.target_dist_m;
      if (meta.rel_alt != null) o.alt = meta.rel_alt;
      if (meta.pitch != null) o.pitch = meta.pitch;
      if (meta.yaw != null) o.yaw = meta.yaw;
      if (meta.model) o.model = meta.model;
      if (meta.sn) o.sn = meta.sn;
    }
    return JSON.stringify(o).slice(0, 2000);
  }

  var DroneMeta = { HEAD_BYTES: HEAD_BYTES, parse: parse, group: group, centroid: centroid, distanceM: distanceM,
                    keywords: keywords, parseTime: parseTime, GAP_S: GAP_S, GAP_M: GAP_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = DroneMeta;
  else g.DroneMeta = DroneMeta;
})(typeof self !== 'undefined' ? self : this);
