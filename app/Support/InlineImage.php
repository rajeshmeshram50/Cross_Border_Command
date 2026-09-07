<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

/**
 * A stored image as a data URI, DOWNSCALED and CACHED, for embedding in a PDF.
 *
 * Why this exists, measured on the live data (07-Sep-2026):
 *
 *   The branch logo on a letterhead is 9653 x 3094 px — 30 megapixels — and is
 *   drawn about 120 px wide. dompdf still decodes and embeds every one of those
 *   pixels:
 *
 *     dompdf, same document, no image ......  0.10s,     2 KB
 *     dompdf, same document, that logo ..... 29.47s,  1.19 MB
 *     fetching it from Azure ...............  3.34s
 *
 *   So a four-page preview took 32.7s and returned a 2 MB PDF, of which the
 *   document itself was a tenth of a second. Live preview re-renders on every
 *   pause in typing, so that cost was paid over and over and the request was
 *   usually cancelled before it finished.
 *
 * Two fixes, both needed:
 *
 *   1. DOWNSCALE. 600 px is far beyond what a header strip uses — it is still
 *      5x the drawn width, which covers 300 DPI print and a retina preview —
 *      and it takes the image from 30 MP to roughly 0.4 MP.
 *   2. CACHE. The logo does not change between keystrokes, but it was re-read
 *      from Azure on every render: three round trips (exists + mimeType + get),
 *      the last of them a 1.17 MB download.
 *
 * The cache is keyed on the path alone with a one-hour TTL. A logo is changed
 * rarely and a preview showing the previous one for up to an hour after a
 * re-upload is a fair trade for removing ~33s from every render; call forget()
 * from the branding-update path if that ever stops being true.
 */
class InlineImage
{
    /** Generous for a letterhead: ~5x the drawn width, so print stays sharp. */
    public const MAX_WIDTH = 600;

    private const TTL = 3600;

    /**
     * Public-disk image path → data URI, or null when unreadable.
     */
    public static function dataUri(?string $path, int $maxWidth = self::MAX_WIDTH): ?string
    {
        $path = trim((string) $path);
        if ($path === '' || str_starts_with($path, 'data:')) return null;

        return Cache::remember(
            self::key($path, $maxWidth),
            self::TTL,
            function () use ($path, $maxWidth) {
                try {
                    /* get() only — NOT exists() + mimeType() + get(). Each of
                       those is its own HTTPS round trip to blob storage, and the
                       first two only answer questions the bytes answer anyway.
                       A missing file throws, which is the same answer. */
                    $raw = Storage::disk('public')->get($path);
                    if (!is_string($raw) || $raw === '') return null;
                    return self::encode($raw, $maxWidth);
                } catch (\Throwable $e) {
                    return null;
                }
            }
        );
    }

    /** Drop a cached image — call after a logo is replaced. */
    public static function forget(?string $path): void
    {
        $path = trim((string) $path);
        if ($path === '') return;
        Cache::forget(self::key($path, self::MAX_WIDTH));
    }

    private static function key(string $path, int $maxWidth): string
    {
        return 'inline-image:' . $maxWidth . ':' . sha1($path);
    }

    private static function encode(string $raw, int $maxWidth): ?string
    {
        $info = @getimagesizefromstring($raw);
        if (!$info) return null;

        [$w, $h] = $info;
        $mime = $info['mime'] ?? 'image/png';

        // Already small enough, or no GD to resize with: embed as it is. An
        // unscaled logo is slow; a missing one is wrong.
        if ($w <= $maxWidth || $w < 1 || $h < 1 || !extension_loaded('gd')) {
            return 'data:' . $mime . ';base64,' . base64_encode($raw);
        }

        $src = @imagecreatefromstring($raw);
        if (!$src) return 'data:' . $mime . ';base64,' . base64_encode($raw);

        $nw = $maxWidth;
        $nh = max(1, (int) round($h * ($maxWidth / $w)));

        $dst = imagecreatetruecolor($nw, $nh);
        /* Transparency has to be carried across explicitly. A logo is normally
           a PNG on a transparent ground, and a truecolor canvas starts BLACK —
           without this the letterhead gains a black rectangle. */
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        $transparent = imagecolorallocatealpha($dst, 0, 0, 0, 127);
        imagefill($dst, 0, 0, $transparent);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);

        ob_start();
        imagepng($dst, null, 6);
        $out = (string) ob_get_clean();

        imagedestroy($src);
        imagedestroy($dst);

        if ($out === '') return 'data:' . $mime . ';base64,' . base64_encode($raw);
        return 'data:image/png;base64,' . base64_encode($out);
    }
}
