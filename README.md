# WRI Recon (offline)

Recon points and photos for WRI incidents that work with **no signal**. Points are saved on the phone
(IndexedDB) and upload by themselves when there's coverage. Each photo goes on its own request, so a weak
signal only needs to carry one photo at a time.

- Live: https://whitewaterrescue.github.io/wri-recon/ (`?incident=<id or project>` preselects the incident)
- Server: the Recon Apps Script (`wri-appscript` → `Initial Response Apps/WRI_Recon_GAS_App_extracted`),
  JSON API in `Api.gs`, shared idempotent write path in `ReconCore.gs`. Same WRI_Recon_v3 layer and sheets as the
  classic Recon page.
- Uploads are protected by the incident (gateway) PIN. A wrong or changed PIN parks the queue until the new PIN
  is entered; nothing is lost.
- Deploy: push to `main` (GitHub Pages, legacy, `/`). Bump `APP_VERSION` in `sw.js` and the `?v=` stamps in
  `index.html` together.
- Cache Storage is shared by every app on whitewaterrescue.github.io: the service worker only deletes caches
  named `wri-recon-*`.
