import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

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
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
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
