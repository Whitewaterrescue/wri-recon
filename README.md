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

## Drone tab (2026-10-26)

SD-card drone photos onto recon points. **Choose drone photos → Browse → the card → DCIM.** Only the first
128 KB of each file is read (`js/dronemeta.js`): DJI XMP (aircraft GPS, the **laser-rangefinder target**
`LRFTargetLat/Lon` on M4T/M30T, altitude, gimbal, model) with EXIF GPS as the fallback, and the EXIF
preview for the thumbnail, so a 100-photo card lists in about a second. Photos are grouped (≤ 60 s and
≤ 75 m apart). Each group is placed at the rangefinder target when it measured one, else the aircraft;
there is no computed angle/altitude projection.

Per group: **Find nearby points** (needs signal; Recon API `nearby`, 150 m, then 500 m) → **Attach N photos
here** (queued as a `dattach` record; the outbox sends one `attach` per photo), or **New point here**
(the Recon form with location, time and up to 20 photos filled in), or **Skip**. Photos are downscaled to
2048 px / q0.8 one at a time; the metadata rides along as the attachment's keywords.
Test: the headless rig in the build session (stubbed API, real DJI frames) passed 19/19.
