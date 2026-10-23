import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

/* VITE_DEV_HOST=<lan ip> serves HMR to a handheld on the Wi-Fi. The page is
   https there, so the dev server has to match or Chrome blocks every asset. */
const devHost = process.env.VITE_DEV_HOST;
const devCert = 'storage/certs/cbc.pem';
const devKey = 'storage/certs/cbc-key.pem';
const lanServer = !devHost ? {} : {
    host: '0.0.0.0',
    cors: true,
    hmr: { host: devHost },
    ...(fs.existsSync(devCert) && fs.existsSync(devKey)
        ? { https: { cert: fs.readFileSync(devCert), key: fs.readFileSync(devKey) } }
        : {}),
};

export default defineConfig({
    // Velzon uses CRA-style process.env.PUBLIC_URL / process.env.NODE_ENV.
    // Vite needs them defined at build time — shim with empty strings so
    // `process.env.PUBLIC_URL + path` just becomes "" + path.
    define: {
        'process.env.PUBLIC_URL': JSON.stringify(''),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        'process.env.REACT_APP_DEFAULTAUTH': JSON.stringify(''),
        'process.env.REACT_APP_API_URL': JSON.stringify(''),
    },
    plugins: [
        laravel({
            // velzon.scss is imported inside resources/js/app.tsx so it's
            // bundled as part of the app.tsx graph — don't declare it here.
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            refresh: true,
            // Disable laravel-vite-plugin's chunk auto-prefetch (v1.0+).
            // It injects <link rel="prefetch"> for every build chunk so
            // navigations feel instant, but in this app there are 100+
            // route-level chunks — Chrome flags each one as "preloaded
            // but not used" because most belong to pages the visitor
            // never opens in that session. Lazy-loaded routes will still
            // fetch on demand; we just lose the eager warm-up.
            prefetch: false,
        }),
        tailwindcss(),
        react(),
    ],
    /* Declared browser support floor (QA #108).
     *
     * There was no `target` and no browserslist anywhere, so Vite fell back to
     * its default ('modules' — roughly Chrome 87 / Safari 14 / Firefox 78) for
     * the JAVASCRIPT while Tailwind 4 was emitting CSS that needs far newer
     * engines: the built app stylesheet carries 69 `@property` rules, 206
     * `color-mix()` calls and 63 `oklch()` colours, none of which exist below
     * Safari 16.4 / Chrome 111 / Firefox 128.
     *
     * The two floors disagreeing is what made the failure so confusing to
     * report: on a browser in that gap the scripts load and run perfectly, so
     * the app is fully interactive, but every custom property resolves to
     * nothing — elements render with no colour, no spacing and no shadow. It
     * reads as "some elements are not displayed correctly" rather than as an
     * unsupported browser, which is exactly how it was filed.
     *
     * Setting the JS target to the SAME floor Tailwind already imposes makes
     * the boundary a single, honest line instead of two invisible ones. It also
     * lets esbuild stop down-levelling syntax these engines support natively.
     *
     * Keep this in step with browserslist in package.json and with
     * MIN_BROWSERS in resources/js/utils/browserSupport.ts — all three describe
     * the same floor and are meant to be changed together. */
    build: {
        target: ['chrome111', 'edge111', 'firefox128', 'safari16.4'],
        rollupOptions: {
            output: {
                /* Rollup's default splitting optimises BYTES, by hoisting any
                   module two route chunks share into a file of its own. That
                   assumes a request is nearly free. On this deployment it is
                   not: measured on the server, a request costs ~1s whatever its
                   size, so /hr/attendance was fetching Card.js (1.2 kB),
                   CardBody.js (1.0 kB), BusyOverlay.js (0.5 kB) and
                   SearchClear.js (0.6 kB) as four separate round trips — 3.3 kB
                   of code for about four seconds. Thirteen requests in total
                   before React could mount the page.

                   So group by WHO NEEDS IT and HOW OFTEN IT CHANGES, not by
                   who happens to share it:

                   vendor-*   framework code, changes only on an upgrade. Its
                              own hash, so a deploy of our code does not make
                              the browser re-download React.
                   shared-ui  our own primitives and form kit, on practically
                              every screen. One request, then cached for every
                              route after it.

                   Everything else keeps Rollup's default, so genuinely
                   route-specific code and big optional libraries (sweetalert2,
                   xlsx, pdfjs) still load only where they are used. */
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        if (/node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom)[\/]/.test(id)) return 'vendor-react';
                        if (/node_modules[\/](redux|react-redux|@reduxjs|immer|reselect)[\/]/.test(id)) return 'vendor-redux';
                        if (/node_modules[\/](reactstrap|@popperjs)[\/]/.test(id)) return 'vendor-ui';
                        return;
                    }
                    /* An ALLOWLIST, not a directory rule. Folding all of
                       components/ui in swept up 568 kB — DataTable (56 kB),
                       MasterSelect, SignaturePad, ImageCropperModal — and put
                       them on first paint for every user. These are the ones
                       that earn it: small, and on practically every screen, so
                       they cost a round trip and almost no bytes. Importer
                       counts measured, not guessed: Tooltip 115, Shimmer 79,
                       SearchClear 64, WorklistPager 50, SegmentBadge 25.
                       The big ones stay split — they are hoisted into a shared
                       chunk by Rollup anyway, fetched once and then cached. */
                    if (/resources[\/]js[\/]components[\/]ui[\/](Tooltip|Shimmer|SearchClear|WorklistPager|SegmentBadge|BusyOverlay|MasterDatePicker|MasterTimePicker)\./.test(id)) return 'shared-ui';
                    if (/resources[\/]js[\/]utils[\/](timeFormat|resolveFileUrl|routeAccess|fieldValidators|oppCrypto)\./.test(id)) return 'shared-ui';
                    if (/resources[\/]js[\/]pages[\/]master[\/]masterFormKit/.test(id)) return 'shared-ui';
                },
            },
        },
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
        ...lanServer,
    },
    // face-api.js is dynamically imported only on the FaceCapture component's
    // first mount, so Vite's initial dep scan misses it and the dev server
    // 404s the pre-bundled chunk ("Failed to fetch dynamically imported
    // module: …/node_modules/.vite/deps/face-api___js.js"). Force-include
    // it here so Vite pre-bundles it on boot and the dynamic import resolves.
    optimizeDeps: {
        include: ['face-api.js'],
    },
});
