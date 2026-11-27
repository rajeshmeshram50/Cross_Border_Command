<?php

use Illuminate\Support\Facades\Storage;

if (!function_exists('file_url')) {
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

        if (!str_contains($normalized, '/')) {
            return null;
        }

        try {
            $url = Storage::disk('public')->url($normalized);
        } catch (\Throwable $e) {
            $base = config('filesystems.disks.public.url')
                ?: rtrim((string) config('app.url', 'http://localhost'), '/') . '/storage';
            $url = rtrim((string) $base, '/') . '/' . $normalized;
        }

        return preg_replace('#(?<!:)//+#', '/', $url);
    }
}
