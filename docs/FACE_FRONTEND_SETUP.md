# Face Detection — Frontend Setup (Live Deployment)

Everything the **frontend** needs for face registration, face clock-in,
and face login. Run these on the live server (or any fresh clone) so the
camera + face-api.js work end-to-end.

---

## 1. NPM package (only ONE new dependency)

```bash
npm install face-api.js@0.22.2 --save
```

This is the only library added for the entire face-detection feature. It
brings TensorFlow.js with it as a peer dep — you don't install tfjs
separately.

If you're cloning fresh and `package.json` already lists it, just run:

```bash
npm ci          # exact-lockfile install for production deploys
# OR
npm install     # if you want to refresh
```

Verify it's there:

```bash
node -e "console.log(require('face-api.js/package.json').version)"
# expect: 0.22.2
```

---

## 2. Model weights (~6.8 MB, hosted in `public/face-models/`)

face-api.js ships only the JS library — the trained model weights are
separate. We self-host them under `public/face-models/` so the SPA loads
them from your own domain (no external CDN, works offline).

### What files you need (7 total)

| Filename | Size | Purpose |
|---|---|---|
| `tiny_face_detector_model-weights_manifest.json` | ~3 KB | Manifest for the detector |
| `tiny_face_detector_model-shard1` | ~190 KB | Detector weights |
| `face_landmark_68_model-weights_manifest.json` | ~8 KB | Manifest for landmarks |
| `face_landmark_68_model-shard1` | ~350 KB | 68-point landmark net |
| `face_recognition_model-weights_manifest.json` | ~18 KB | Manifest for recognizer |
| `face_recognition_model-shard1` | ~4 MB | Recognizer part 1 |
| `face_recognition_model-shard2` | ~2.2 MB | Recognizer part 2 |

### Command to download all 7 in one shot

```bash
mkdir -p public/face-models
cd public/face-models

for f in \
  tiny_face_detector_model-weights_manifest.json \
  tiny_face_detector_model-shard1 \
  face_landmark_68_model-weights_manifest.json \
  face_landmark_68_model-shard1 \
  face_recognition_model-weights_manifest.json \
  face_recognition_model-shard1 \
  face_recognition_model-shard2
do
  echo "→ $f"
  curl -sSL -o "$f" "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/$f"
done

ls -lh
# expect ~6.8 MB across 7 files
```

If the curl line fails on Windows, run the same loop in **Git Bash** or
download the 7 files manually from
<https://github.com/justadudewhohacks/face-api.js/tree/master/weights>
and drop them into `public/face-models/`.

---

## 3. Vite config patch

face-api.js is loaded via `import('face-api.js')` (dynamic) so the SPA
doesn't pay the ~1 MB cost on pages that don't use the camera. Vite's
initial dep scan misses dynamic imports, so the dev server 404s the
pre-bundled chunk on first use.

Fix is **already in** `vite.config.js`:

```js
export default defineConfig({
  // …
  optimizeDeps: {
    include: ['face-api.js'],
  },
});
```

If you're applying to a fresh repo: ensure that block is present.

After editing `vite.config.js`, **clear the stale dep cache** so Vite
re-pre-bundles on next start:

```bash
rm -rf node_modules/.vite
```

Then restart `npm run dev`.

For **production builds** (Rollup) no extra step is needed — Rollup
follows dynamic imports natively.

---

## 4. HTTPS requirement on live

`navigator.mediaDevices.getUserMedia()` (the API that opens the webcam)
refuses to run on plain `http://` outside localhost. The live URL **must**
be `https://`.

Check your live URL:

```bash
# from any browser
window.isSecureContext   // must be true
```

If your live env is still on http://, the registration / clock-in screens
will show **"Camera permission was denied"** — even though the user never
saw a permission prompt. Fix the SSL cert before debugging anything else.

---

## 5. Build commands

### Dev (local)

```bash
npm run dev
# Vite dev server on http://localhost:5173 (or whatever the project uses)
# Auto-reloads on file change.
```

### Production build

```bash
npm run build
# Outputs to public/build/ — Laravel-vite-plugin reads the manifest from there.
```

The build copies `public/face-models/*` into the deploy artifact as-is
(Vite copies `public/` verbatim into the build output).

### Preview the production build locally

```bash
npm run preview
```

---

## 6. Environment variable (optional)

You can override where face-api.js loads models from via Vite env:

```env
# .env (or .env.production)
VITE_FACE_MODEL_URL=/face-models
```

Default is `/face-models` (self-hosted). Change to a CDN URL if you ever
move the weights to S3 / CloudFront — e.g.
`VITE_FACE_MODEL_URL=https://cdn.example.com/face-models`.

---

## 7. Final sanity check after deploy

In the browser console on the live site:

```js
// 1. SPA loaded under HTTPS?
window.isSecureContext
// expect: true

// 2. Model URL is reachable
fetch('/face-models/tiny_face_detector_model-weights_manifest.json')
  .then(r => r.json()).then(j => console.log('manifest OK', j))
  .catch(e => console.error('manifest FAIL', e));

// 3. Camera permission works (run from a user gesture — click somewhere first)
navigator.mediaDevices.getUserMedia({ video: true })
  .then(s => { console.log('camera OK'); s.getTracks().forEach(t => t.stop()); })
  .catch(e => console.error('camera FAIL', e));
```

All three should succeed. If (2) 404s, your model files didn't ship —
re-run §2. If (3) fails with `NotAllowedError`, the user clicked Block on
the permission prompt — they can re-grant via the browser's site
settings.

---

## 8. Quick troubleshooting table

| Symptom | Cause | Fix |
|---|---|---|
| `Failed to fetch dynamically imported module: face-api___js.js` | Stale Vite dep cache | `rm -rf node_modules/.vite` + restart `npm run dev` |
| "Loading face-recognition models…" forever | Files missing under `public/face-models/` | Re-run §2 download loop |
| "Camera permission was denied" but no prompt appeared | http:// (not https://) or browser already denied | Switch to HTTPS; or reset Site Settings → Camera |
| Face captures but no face detected | Lighting too dark, face too far, multiple faces in frame | User-side fix — better lighting, one face only, fill the circle |
| `face-api.js` import error in production but works in dev | Build output didn't include `public/face-models/` | Verify `public/face-models/*` is in your deploy artifact / docker image |

---

## 9. Files this setup touches (recap)

| File | What |
|---|---|
| `package.json` | `face-api.js@0.22.2` in dependencies |
| `package-lock.json` | Locked version (commit this) |
| `public/face-models/*` | 7 weight files, ~6.8 MB |
| `vite.config.js` | `optimizeDeps.include: ['face-api.js']` |
| (optional) `.env.production` | `VITE_FACE_MODEL_URL=` if you move weights off-domain |

That's it for the frontend. The backend pieces are in
`docs/FACE_ATTENDANCE.md`.
