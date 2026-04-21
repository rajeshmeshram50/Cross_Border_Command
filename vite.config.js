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
        }),
        tailwindcss(),
        react(),
    ],
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
