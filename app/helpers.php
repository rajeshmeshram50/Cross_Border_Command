<?php

use Illuminate\Support\Facades\Storage;

if (!function_exists('file_url')) {
    /**
     * Resolve a stored file path to a public URL.
     *
     * Accepts:
     *   - Already-absolute URLs (https://...) → returned as-is
     *   - Legacy paths starting with "storage/" or "public/" → prefix is stripped
     *   - Relative disk paths → resolved via Storage::url() on the configured disk
     *
     * Returns null for empty input. Bare basenames (e.g. "Bhuvan.jpg" with no
     * folder separator) are also returned as null — every legitimate upload in
     * the app lives in a subdirectory (products/images, products/qc, vendors,
     * etc.), so a path with no "/" is always a stale / malformed reference
     * from an older client and we don't want to surface a 404 link for it.
     *
     * @param string|null $path
     * @return string|null
     */
    function file_url(?string $path): ?string
    {
        if (!$path) {
            return null;
        }

        $val = trim($path);

        if (preg_match('#^https?://#i', $val)) {
            return $val;
        }

        $normalized = str_replace('\\', '/', $val);
        $normalized = ltrim($normalized, '/');

        if (str_starts_with($normalized, 'storage/')) {
            $normalized = substr($normalized, strlen('storage/'));
        }

        if (str_starts_with($normalized, 'public/')) {
            $normalized = substr($normalized, strlen('public/'));
        }

        // Bare basename (no folder prefix) → almost certainly a stale row from
        // a buggy save that stored just the display name. Resolving it would
        // produce a confident-looking but broken URL (/storage/Bhuvan.jpg on
        // local, .../cbc-saas/Bhuvan.jpg on Azure). Treat as missing.
        if (!str_contains($normalized, '/')) {
            return null;
        }

        // Try the configured disk first. If the disk's `url` config is empty
        // (e.g. AZURE_STORAGE_URL not set, config not refreshed after deploy),
        // Laravel throws "This driver does not support retrieving URLs."
        // Fall back to a constructed URL so the API never crashes for a
        // misconfigured prod env — the resulting URL may 404, but the
        // response shape stays intact and the issue is visible at the
        // image instead of breaking the whole request.
        try {
            $url = Storage::disk('public')->url($normalized);
        } catch (\Throwable $e) {
            $base = config('filesystems.disks.public.url')
                ?: rtrim((string) config('app.url', 'http://localhost'), '/') . '/storage';
            $url = rtrim((string) $base, '/') . '/' . $normalized;
        }

        // Collapse accidental double slashes ("http://host//storage//path")
        // that creep in when env values or path joins disagree on trailing
        // slashes. Preserve the protocol "://".
        return preg_replace('#(?<!:)//+#', '/', $url);
    }
}
