<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

/**
 * Writes a screen-sized "<base>-w.png" beside an uploaded tenant logo, for the
 * header to use instead of the original.
 *
 * Why this exists. The header logo is the LCP element on every page — it is
 * the largest thing painted — and tenants upload print assets: the logo on
 * live is 9653x3094 and weighs 1.1 MB, with a dark variant of the same size
 * beside it. The header renders it at 52px tall. So the browser downloads
 * 1.1 MB and decodes 30 megapixels (~120 MB of RGBA) to paint a 162x52 strip,
 * and because the src comes from the signed-in user it cannot even start until
 * the auth call returns. Measured LCP: 3.4-3.8 s, with DevTools naming
 * img.idims-logo-full.
 *
 * The same file is ALSO embedded in PDF headers — agreements, trade
 * documents, CTC contracts, payslips — where the full resolution is wanted,
 * because a 160px image printed at 300dpi is a blur. So the original is never
 * touched. This writes a second, small file next to it and only the header
 * asks for that one.
 *
 * At the cap below the live logo comes out around 30 KB, against 1.1 MB.
 *
 * Mirrors LogoDarkVariantGenerator: same disk, same relative-path convention,
 * same failure-safety — a logo that cannot be resized must never break the
 * upload, and the header falls back to the original if the variant is missing.
 */
class LogoWebVariantGenerator
{
    /** 52px slot; 160 is 3x, past what any current display asks for. */
    private const MAX_H = 160;

    /** Also cap width, so a banner-shaped logo cannot come out enormous. */
    private const MAX_W = 640;

    /** Generate for the logo AND for its dark variant, if one is there. */
    public static function generate(?string $relativePath): void
    {
        if (!$relativePath) return;
        self::one($relativePath);

        // The dark variant is produced at full resolution too (see
        // LogoDarkVariantGenerator), so dark mode downloads its own megabyte.
        $dark = self::swapExt($relativePath, '-dark.png');
        if ($dark && Storage::disk('public')->exists($dark)) {
            self::one($dark);
        }
    }

    /** Remove both web variants beside a logo (call before deleting the logo). */
    public static function delete(?string $relativePath): void
    {
        try {
            if (!$relativePath) return;
            $disk = Storage::disk('public');
            foreach ([self::webPath($relativePath), self::webPath(self::swapExt($relativePath, '-dark.png'))] as $p) {
                if ($p) $disk->delete($p);
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * The screen-sized file that belongs beside this one, keeping the source's
     * own extension: logo.png -> logo-w.png, logo.jpg -> logo-w.jpg.
     *
     * Not always-PNG, which is what this did first. GD re-encodes a palette
     * (8-bit) PNG as truecolor, and a tenant logo that was 5.6 KB came back
     * out at 44.9 KB — a "small" variant eight times bigger than the file it
     * was meant to replace. Keeping the format lets an already-small source be
     * copied through byte for byte instead of re-encoded.
     */
    public static function webPath(?string $relativePath): ?string
    {
        if (!$relativePath) return null;
        if (!preg_match('/\.(png|jpe?g|webp)$/i', $relativePath, $m)) return null;

        return preg_replace('/\.(png|jpe?g|webp)$/i', '-w.' . strtolower($m[1]), $relativePath);
    }

    /**
     * The "-w" path, but only when that file is actually on disk — otherwise
     * null.
     *
     * This is what /me uses to hand the header a URL instead of letting the
     * frontend guess one. Guessing meant that on any environment where
     * logos:backfill-web had not been run the header requested a file that was
     * not there, took a 404, and only then fell back to the full logo: the
     * same megabyte, plus a wasted round trip. Asking the disk means a missing
     * variant costs nothing and the command can be run whenever.
     */
    public static function existingWebPath(?string $relativePath): ?string
    {
        try {
            $web = self::webPath($relativePath);

            return ($web && Storage::disk('public')->exists($web)) ? $web : null;
        } catch (\Throwable $e) {
            return null; // a disk that cannot be read must not break /me
        }
    }

    private static function one(string $relativePath): void
    {
        try {
            $ext = strtolower(pathinfo($relativePath, PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) return; // svg is already small
            if (!function_exists('imagecreatefromstring')) return;             // GD unavailable

            $disk = Storage::disk('public');
            if (!$disk->exists($relativePath)) return;

            $out = self::webPath($relativePath);
            if (!$out || $out === $relativePath) return;

            $bytes = $disk->get($relativePath);

            $size = @getimagesizefromstring($bytes);
            if (!$size || ($size[0] ?? 0) < 1 || ($size[1] ?? 0) < 1) return;
            [$w, $h] = $size;

            $scale = min(self::MAX_H / $h, self::MAX_W / $w, 1.0);
            if ($scale >= 1.0) {
                /* Already within the cap. Copy the original bytes rather than
                   decoding and re-encoding them: GD would hand back a
                   truecolor PNG where the source was an optimised palette one,
                   and the "small" variant would come out several times larger
                   than the file it replaces. The header can then always ask
                   for "-w" and find something. */
                $disk->put($out, $bytes);
                return;
            }

            $src = @imagecreatefromstring($bytes);
            if (!$src) return;
            // Palette PNGs must be normalised before resampling or the copy
            // comes out with the wrong colours (same reason as the dark
            // generator).
            if (function_exists('imagepalettetotruecolor')) { imagepalettetotruecolor($src); }

            $nw = max(1, (int) round($w * $scale));
            $nh = max(1, (int) round($h * $scale));

            $dst = imagecreatetruecolor($nw, $nh);
            // Alpha blending OFF plus savealpha ON is what preserves a
            // transparent background through the resample; with blending on,
            // transparent pixels composite onto black.
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefilledrectangle($dst, 0, 0, $nw, $nh, imagecolorallocatealpha($dst, 0, 0, 0, 127));
            imagealphablending($dst, true);
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
            imagealphablending($dst, false);

            $encoded = self::encode($dst, $ext);
            imagedestroy($src);
            imagedestroy($dst);

            // A resize that did not actually save anything is not worth having
            // — fall back to the original bytes under the same name.
            $disk->put($out, ($encoded !== '' && strlen($encoded) < strlen($bytes)) ? $encoded : $bytes);
        } catch (\Throwable $e) {
            report($e); // swallow — never block the upload
        }
    }

    private static function swapExt(?string $relativePath, string $suffix): ?string
    {
        if (!$relativePath) return null;
        $swapped = preg_replace('/\.(png|jpe?g|webp)$/i', $suffix, $relativePath);

        return $swapped === $relativePath ? null : $swapped;
    }

    /** Re-encode in the SOURCE's format, so the "-w" file matches its name. */
    private static function encode($im, string $ext): string
    {
        ob_start();
        match ($ext) {
            'jpg', 'jpeg' => imagejpeg($im, null, 85),
            'webp'        => imagewebp($im, null, 90),
            default       => imagepng($im, null, 9),
        };

        return (string) ob_get_clean();
    }
}
