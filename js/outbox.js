/* WRI Recon (offline) — the outbox. Runs in the page and in the service worker.
 *
 * A saved point is a `records` row plus one `photos` row per photo. The drain
 * sends the point (submit), then each photo on its own request (photo), so a
 * weak signal only has to carry one ~0.5 MB photo at a time and a failure only
 * costs that photo. Both calls are idempotent on the server (recon_id,
 * recon_id+idx), so a replay after a lost reply never duplicates anything.
 *
 * Record status:  queued -> sent            (all photos sent or given up)
 *                 queued -> needs_pin       (PIN wrong/changed; new PIN re-queues)
 *                 queued -> failed          (permanent: e.g. incident closed; user fixes or discards)
 * A transient failure (no signal, timeout, server busy) leaves the record queued
 * with a backoff, and the drain moves on to the next record: one stuck point
 * never blocks the others.
 */
(function (g) {
  var BACKOFF_MIN = 20000, BACKOFF_MAX = 10 * 60000, KEEP_SENT_MS = 24 * 3600000;
  var running = false;

  function emit() {
    try {
      if (g.document) g.dispatchEvent(new Event('outbox:changed'));
      else if (g.clients) g.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: 'outbox:changed' }); }); });
    } catch (e) {}
  }

  function backoff(n) { return Math.min(BACKOFF_MAX, BACKOFF_MIN * Math.pow(2, Math.max(0, n - 1))); }

  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf), bin = '', CH = 0x8000;
      for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(bin);
    });
  }

  function uploadTimeout(bytes) { return Math.max(60000, Math.round(bytes / 15)); }   // ~15 KB/s floor

  var Outbox = {
    /** Save a point + its photo Blobs. record: {recon_id, incident, fields}; photos: [{blob, name}] */
    enqueue: function (record, photos) {
      record.created_at = Date.now();
      record.status = 'queued';
      record.attempts = 0; record.next_try = 0;
      record.photo_count = photos.length;
      var puts = photos.map(function (p, i) {
        return Store.put('photos', { key: record.recon_id + '/' + i, recon_id: record.recon_id, idx: i, name: p.name || '',
                                     blob: p.blob, size: p.blob.size, status: 'queued' });
      });
      return Promise.all(puts).then(function () { return Store.put('records', record); })
        .then(function () { emit(); setTimeout(Outbox.drain, 50); });
    },

    /** Send everything that's due. Safe to call often; only one drain runs at a time. */
    drain: function () {
      if (g.navigator && g.navigator.locks) {
        return g.navigator.locks.request('wri-recon-drain', { ifAvailable: true }, function (lock) {
          return lock ? drainOnce() : null;
        });
      }
      return drainOnce();
    },

    summary: function () {
      return Promise.all([Store.all('records'), Store.all('photos')]).then(function (a) {
        var recs = a[0] || [], photos = a[1] || [];
        var s = { queued: 0, needs_pin: 0, failed: 0, sent: 0, photos_waiting: 0, photos_failed: 0 };
        recs.forEach(function (r) { s[r.status] = (s[r.status] || 0) + 1; });
        var open = {}; recs.forEach(function (r) { if (r.status !== 'sent') open[r.recon_id] = 1; });
        photos.forEach(function (p) {
          if (p.status === 'queued' && open[p.recon_id]) s.photos_waiting++;
          if (p.status === 'failed') s.photos_failed++;
        });
        return s;
      });
    },

    list: function () {
      return Promise.all([Store.all('records'), Store.all('photos')]).then(function (a) {
        var by = {};
        (a[1] || []).forEach(function (p) { (by[p.recon_id] = by[p.recon_id] || []).push(p); });
        return (a[0] || []).sort(function (x, y) { return y.created_at - x.created_at; }).map(function (r) {
          var ps = (by[r.recon_id] || []).sort(function (x, y) { return x.idx - y.idx; });
          r.photos = ps.map(function (p) { return { idx: p.idx, status: p.status, error: p.last_error || '', blob: p.blob || null }; });
          return r;
        });
      });
    },

    /** Re-queue a record (and its failed photos) now. Optional new incident for an incident_unknown failure. */
    retry: function (reconId, newIncident) {
      return Store.get('records', reconId).then(function (r) {
        if (!r) return;
        if (newIncident) r.incident = newIncident;
        r.status = 'queued'; r.attempts = 0; r.next_try = 0; r.last_error = ''; r.error_code = '';
        return Store.photosFor(reconId).then(function (ps) {
          return Promise.all(ps.filter(function (p) { return p.status === 'failed' && p.blob; }).map(function (p) {
            p.status = 'queued'; p.last_error = ''; p.attempts = 0; return Store.put('photos', p);
          }));
        }).then(function () { return Store.put('records', r); });
      }).then(function () { emit(); return Outbox.drain(); });
    },

    discard: function (reconId) {
      return Store.photosFor(reconId).then(function (ps) {
        return Promise.all(ps.map(function (p) { return Store.del('photos', p.key); }));
      }).then(function () { return Store.del('records', reconId); }).then(emit);
    },

    /** New PIN: every needs_pin record goes back in the queue. */
    setPin: function (pin) {
      return Store.kvSet('pin', String(pin || '').trim()).then(function () { return Store.all('records'); }).then(function (rs) {
        return Promise.all((rs || []).filter(function (r) { return r.status === 'needs_pin'; }).map(function (r) {
          r.status = 'queued'; r.next_try = 0; return Store.put('records', r);
        }));
      }).then(function () { emit(); return Outbox.drain(); });
    },

    prune: function () {
      var cut = Date.now() - KEEP_SENT_MS;
      return Store.all('records').then(function (rs) {
        return Promise.all((rs || []).filter(function (r) { return r.status === 'sent' && (r.sent_at || 0) < cut; })
          .map(function (r) { return Outbox.discard(r.recon_id); }));
      });
    }
  };

  function drainOnce() {
    if (running) return Promise.resolve();
    running = true;
    var pin, device, stop = false;
    return Promise.all([Store.kvGet('pin'), Store.deviceId(), Store.all('records')]).then(function (a) {
      pin = a[0]; device = a[1];
      var due = (a[2] || []).filter(function (r) { return r.status === 'queued'; })
        .sort(function (x, y) { return x.created_at - y.created_at; });
      if (!due.length) return;
      if (!pin) {   // nothing can go without the PIN: park them where the UI asks for it
        return Promise.all(due.map(function (r) { r.status = 'needs_pin'; return Store.put('records', r); }));
      }
      return due.reduce(function (p, r) {
        return p.then(function () {
          if (stop || (r.next_try || 0) > Date.now()) return;
          return sendRecord(r, pin, device).catch(function (e) {
            if (e.code === 'pin_invalid') {
              stop = true;
              return Store.all('records').then(function (rs) {
                return Promise.all(rs.filter(function (x) { return x.status === 'queued'; }).map(function (x) {
                  x.status = 'needs_pin'; x.last_error = e.message; return Store.put('records', x);
                }));
              });
            }
            if (e.offline) {   // no signal: not this record's fault -- no backoff, stop and wait for signal
              stop = true; r.last_error = 'No signal';
            } else if (e.permanent) { r.status = 'failed'; r.error_code = e.code; r.last_error = e.message; }
            else { r.attempts = (r.attempts || 0) + 1; r.next_try = Date.now() + backoff(r.attempts); r.last_error = e.message; }
            return Store.put('records', r);
          }).then(emit);
        });
      }, Promise.resolve());
    }).then(function () { return Outbox.prune(); })
      .catch(function (e) { try { console.warn('drain', e); } catch (x) {} })
      .then(function () { running = false; emit(); });
  }

  function sendRecord(r, pin, device) {
    var first = r.oid ? Promise.resolve() : Api.post('submit', Object.assign({}, r.fields, {
      pin: pin, device: device, recon_id: r.recon_id, incident_id: r.incident.incident_id, photo_count: r.photo_count
    })).then(function (d) {
      r.oid = d.arcgis_oid; r.project_name = d.project_name; r.last_error = '';
      return Store.put('records', r).then(emit);
    });
    return first.then(function () { return Store.photosFor(r.recon_id); }).then(function (ps) {
      return ps.reduce(function (p, ph) {
        return p.then(function () {
          if (ph.status !== 'queued' || !ph.blob) return;
          return blobToBase64(ph.blob).then(function (b64) {
            return Api.post('photo', { pin: pin, device: device, recon_id: r.recon_id, idx: ph.idx, name: ph.name, base64: b64 },
                            uploadTimeout(ph.size || b64.length));
          }).then(function () {
            ph.status = 'sent'; ph.blob = null; ph.last_error = '';
            return Store.put('photos', ph).then(emit);
          }, function (e) {
            if (!e.permanent) throw e;   // transient / PIN: the record's handler decides
            ph.status = 'failed'; ph.last_error = e.message;
            return Store.put('photos', ph).then(emit);
          });
        });
      }, Promise.resolve());
    }).then(function () { return Store.photosFor(r.recon_id); }).then(function (ps) {
      r.photos_failed = ps.filter(function (p) { return p.status === 'failed'; }).length;
      r.status = 'sent'; r.sent_at = Date.now(); r.last_error = '';
      return Store.put('records', r);
    });
  }

  g.Outbox = Outbox;
})(self);
