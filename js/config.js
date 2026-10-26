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
  TABS: ['recon', '214', 'rr'],
  MAX_PHOTOS: 10,          // per point (phone storage; the classic page allows 20)
  PHOTO_EDGE: 1600,        // px, longest edge after downscale
  PHOTO_QUALITY: 0.8,      // JPEG
  CATEGORIES: ['Response Actions', 'Observations', 'Safety'],
  AFFILIATIONS: ['Responsible Party', 'Agency', 'Contractor', 'Private Citizen', 'Other'],
  // satellite tiles for the online pin map (public, no key)
  TILE_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
};
self.CONFIG = CONFIG;
