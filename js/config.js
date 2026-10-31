/* WRI Recon (offline) — settings shared by the page and the service worker. */
var CONFIG = {
  // Recon Apps Script, dedicated API deployment (Api.gs). Same script and layer as the classic page.
  API_URL: 'https://script.google.com/macros/s/AKfycbzJ9Jniz2PZ99rShnFHT_mtsug92C7W4RiOwh7hTDc2SUIBnrsSxuzcie1Y1yfRcne1/exec',
  // P4 forms: each posts to the Apps Script that owns its data (all PIN-gated, idempotent)
  HASP_API: 'https://script.google.com/macros/s/AKfycbwr9Wsw4ODXLIFJA9sTNzjqau-5576zxXxLe1oXHstbW0Qp3AlXjQ_BbxMm9cuYDtN3/exec',
  LOGISTICS_API: 'https://script.google.com/macros/s/AKfycbzdbJxKm9RKm58deSqvrsFQ5GFb-zbaLIZxokwL7JQH-UL5gOAnxqurHaLVuS0NSHyA/exec',
  VESSEL_API: 'https://script.google.com/macros/s/AKfycbwRI7OYT1XKz6_u7fGq-4OYLPCcxxaWGAyNYSxvx7K_u_Z7nNB_PUh5uPuiZy59vNIj/exec',
  // Tabs shown. HASP sign-off and the vessel manifest are built (forms-ui.js, server APIs
  // live) but switched off 2026-10-26 per Cody; add 'hasp' / 'vessel' back here to show them.
  TABS: ['recon', 'drone', '214', 'rr', 'drill'],
  MAX_PHOTOS: 10,          // per point (phone storage; the classic page allows 20)
  PHOTO_EDGE: 1600,        // px, longest edge after downscale
  PHOTO_QUALITY: 0.8,      // JPEG
  // Drone tab: SD-card photos filed onto recon points (2026-10-26)
  DRONE_MAX_BATCH: 200,    // photos read per pick (only the ~128 KB header of each is read)
  DRONE_PER_POINT: 20,     // photos on a NEW point started from drone photos (server cap 20)
  DRONE_EDGE: 2048,        // px: drone frames keep more detail than phone shots
  DRONE_QUALITY: 0.8,      // ~1 MB per M4T frame at 2048 px
  DRONE_RADIUS_M: 150,     // nearby recon points searched around a group (wider: 500)
  // WRI Drone Cloud (P3): photos Pilot 2 auto-uploaded after landing, listed by incident
  DRONE_CLOUD_URL: 'https://drone.whitewaterrescue.com',
  // 214 quick log: one tap logs the item (time = now). A trailing … asks for details first.
  // Page 1 = the categories (big red buttons; icon keys are drawn in forms-ui.js).
  // Page 2 = the activities as pills: [label, emoji, color go | info | warn | alert | idle].
  QUICK_214: [
    { group: 'Arrive / Depart', icon: 'truck', items: [
      ['Departed for site', '🚗', 'info'], ['Arrived on scene', '📍', 'go'], ['Checked in at ICP / staging', '📋', 'go'],
      ['Briefing attended', '🗣️', 'info'], ['Assigned to…', '👷', 'info'], ['Break', '☕', 'idle'],
      ['Resumed work', '▶️', 'go'], ['Departed scene', '🚙', 'info'], ['Shift complete / demobilized', '🏁', 'idle']] },
    { group: 'Safety', icon: 'hardhat', items: [
      ['Safety briefing / tailgate held', '🦺', 'go'], ['JSA reviewed with crew', '📝', 'go'], ['PPE checked', '🧤', 'go'],
      ['Work zone set up', '🚧', 'go'], ['Air monitoring reading…', '🌬️', 'info'], ['Decon set up', '🚿', 'go'],
      ['Decon complete', '✅', 'go'], ['Near miss…', '⚠️', 'warn'], ['Injury reported…', '🩹', 'alert'], ['Stop work…', '✋', 'alert']] },
    { group: 'Response', icon: 'waves', items: [
      ['Site assessment started', '🔍', 'info'], ['Site assessment complete', '✅', 'go'], ['Boom deployed…', '〰️', 'go'],
      ['Boom checked / adjusted', '🔧', 'info'], ['Boom recovered', '↩️', 'idle'], ['Skimmer deployed', '⚙️', 'go'],
      ['Skimmer recovered', '↩️', 'idle'], ['Sorbents deployed', '🧽', 'go'], ['Product recovered…', '🛢️', 'go'],
      ['Sample taken…', '🧪', 'info'], ['Drone flight launched', '🛫', 'info'], ['Drone flight complete', '🛬', 'idle'],
      ['Wildlife observed…', '🦆', 'warn'], ['Oil observed…', '💧', 'warn']] },
    { group: 'Logistics / Comms', icon: 'radio', items: [
      ['Equipment arrived…', '📦', 'go'], ['Equipment problem…', '🛠️', 'warn'], ['Resource request sent…', '📨', 'info'],
      ['Fuel / supplies run', '⛽', 'idle'], ['Supervisor notified…', '📞', 'info'], ['Agency / landowner on scene…', '🏛️', 'info'],
      ['Radio / comms check', '📻', 'info']] }
  ],
  CATEGORIES: ['Response Actions', 'Observations', 'Safety'],
  AFFILIATIONS: ['Responsible Party', 'Agency', 'Contractor', 'Private Citizen', 'Other'],
  // satellite tiles for the online pin map (public, no key)
  TILE_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
};
self.CONFIG = CONFIG;
