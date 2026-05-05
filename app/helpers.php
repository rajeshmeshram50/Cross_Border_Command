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

        return Storage::disk('public')->url($normalized);
    }
}
