# PulleyLab

[Open PulleyLab](https://pulleylab.vercel.app)

Design HTD timing pulleys, inspect the actual 3D solid, and download STEP files for Fusion or STL files for printing. CAD runs entirely in your browser using OpenCascade WebAssembly. No account, API key, database, or CAD server is required.

## Features

- HTD 3M, 5M, and 8M; 12–240 teeth, with HTD 8M selected initially.
- Belt width, total face clearance, bore, one/two/no flanges, flange chamfers, and an optional bottom hub.
- Orbit, top/side views, edge and grid overlays, and three display finishes.
- STEP solid exports with analytic circular geometry and millimeter units; binary STL exports.
- Local saved settings, import/export JSON presets, and shareable URLs containing the dimensions.
- Downloads include every active build setting. For example:

```text
pulleylabs_HTD_8M_24Teeth_20mmBelt_8mmBore_1mmClearance_2Flanges_1.5mmThick_2mmOverhang_0.4mmChamfer_NoHub.step
```

## Run locally

Use Node.js 22.12 or later and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The first build downloads a CAD engine of approximately 7.3 MB compressed; subsequent builds reuse the browser cache. Each generation runs in a fresh worker that is terminated afterward to release its memory. Generation can be cancelled, and a 90-second limit prevents a stalled build from blocking the interface.

## Deploy to Vercel

Import this GitHub repository into Vercel. The checked-in `vercel.json` configures Vite, `npm ci`, `npm run build`, and the `dist` output directory. No environment variables are required. The result is a static website; CAD computation takes place on the visitor’s device.

## Verify

```sh
npm test
npm run build
npm run test:e2e
```

Browser tests use an installed Google Chrome. Set `PULLEYLAB_URL` to test a deployed instance; otherwise the tests start or reuse the local development server. Geometry tests check all three profiles at multiple tooth counts, solid validity, bore/hub volume, STEP representation, and filenames. Browser tests cover generation, downloads, stale-model protection, invalid dimensions, presets, shared builds, and a phone viewport.

## Profile and fit notes

HTD geometry follows the circular-arc construction and nominal constants in FreeCAD Gears. These are not GT/GT2 profiles. Physical belt fit has not been verified; make a short test piece and adjust your manufacturing process before making the final part. Filenames capture nominal input dimensions. STEP imports as a body, without a Fusion parameter timeline. Add keyways, set screws, and other shaft features in Fusion.

The browser validates the result as one positive-volume solid before enabling downloads. The default 24-tooth 8M STEP was independently imported into CadQuery and matched the original local generator’s volume (59,879.679381 mm³) and 24 mm overall width.

## Source and licenses

Application code is GPL-3.0-or-later because the HTD construction is adapted from FreeCAD Gears. See `LICENSE` and `public/NOTICE.txt` for attribution and third-party licenses. The decorative particle background belongs to Joseph Kaisner and is excluded from the code license. Exported pulley files are your generated output; the app does not add a license restriction to those files.
