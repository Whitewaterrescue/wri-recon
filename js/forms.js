/* WRI field app (offline) — where each kind of saved record uploads to.
 * Loaded by the page and the service worker (the outbox looks kinds up here).
 * Every endpoint takes {action, payload:{pin, device, id, incident_id, ...fields}},
 * checks the incident PIN and is idempotent by `id`.
 */
self.FORM_KINDS = {
  '214':  { label: 'ICS 214 note',    action: 'offline_214',    url: function () { return CONFIG.LOGISTICS_API; } },
  'rr':   { label: 'Resource request', action: 'offline_rr',    url: function () { return CONFIG.LOGISTICS_API; } },
  'hasp': { label: 'HASP sign-off',   action: 'offline_ack',    url: function () { return CONFIG.HASP_API; } },
  'vessel': { label: 'Vessel manifest', action: 'offline_vessel', url: function () { return CONFIG.VESSEL_API; } }
};
