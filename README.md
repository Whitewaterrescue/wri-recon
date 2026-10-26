# WRI Field Forms (offline)

Recon points (with photos), ICS 214 notes, HASP sign-offs, a vessel manifest and 213-RR resource requests
for WRI incidents, all working with **no signal** (tabs; `#214`, `#hasp`, `#vessel`, `#rr` open a tab directly). Points are saved on the phone
(IndexedDB) and upload by themselves when there's coverage. Each photo goes on its own request, so a weak
signal only needs to carry one photo at a time.

- Live: https://whitewaterrescue.github.io/wri-recon/ (`?incident=<id or project>` preselects the incident)
- Server: the Recon Apps Script (`wri-appscript` → `Initial Response Apps/WRI_Recon_GAS_App_extracted`),
  JSON API in `Api.gs`, shared idempotent write path in `ReconCore.gs`. Same WRI_Recon_v3 layer and sheets as the
  classic Recon page.
- Where each form uploads: `js/forms.js` (HASP V5 `OfflineApi.gs`, Logistics `OfflineApi.js` for 214 + 213-RR,
  Vessel Ops `OfflineApi.gs`; all PIN-gated and idempotent by the record id).
- Uploads are protected by the incident (gateway) PIN. A wrong or changed PIN parks the queue until the new PIN
  is entered; nothing is lost.
- Deploy: push to `main` (GitHub Pages, legacy, `/`). Bump `APP_VERSION` in `sw.js` and the `?v=` stamps in
  `index.html` together.
- Cache Storage is shared by every app on whitewaterrescue.github.io: the service worker only deletes caches
  named `wri-recon-*`.
