/* WRI Recon (offline) — settings shared by the page and the service worker. */
var CONFIG = {
  // Recon Apps Script, dedicated API deployment (Api.gs). Same script and layer as the classic page.
  API_URL: 'https://script.google.com/macros/s/AKfycbzJ9Jniz2PZ99rShnFHT_mtsug92C7W4RiOwh7hTDc2SUIBnrsSxuzcie1Y1yfRcne1/exec',
  MAX_PHOTOS: 10,          // per point (phone storage; the classic page allows 20)
  PHOTO_EDGE: 1600,        // px, longest edge after downscale
  PHOTO_QUALITY: 0.8,      // JPEG
  CATEGORIES: ['Response Actions', 'Observations', 'Safety'],
  AFFILIATIONS: ['Responsible Party', 'Agency', 'Contractor', 'Private Citizen', 'Other'],
  // satellite tiles for the online pin map (public, no key)
  TILE_URL: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
};
self.CONFIG = CONFIG;
