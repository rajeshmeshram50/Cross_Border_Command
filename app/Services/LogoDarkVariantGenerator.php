<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

/**
 * Generates a dark-mode "<base>-dark.png" variant beside an uploaded tenant
 * logo so the horizontal header (IdimsHeader) can swap to it in dark mode with
 * no white box. Logic mirrors the one-off backfill:
 *   · logo on a white / transparent backdrop  -> strip bg + lighten dark ink
 *   · full-bleed coloured-background logo      -> keep as-is (already readable)
 *
 * Output keeps the original resolution (lossless PNG), so quality is preserved.
 * Every method is failure-safe: a bad image must never break a logo upload.
 */
class LogoDarkVariantGenerator
{
    /** Build the dark variant for a logo stored on the 'public' disk. */
    public static function generate(?string $relativePath): void
    {
        try {
            if (!$relativePath) return;
            $ext = strtolower(pathinfo($relativePath, PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) return; // skip svg/gif
            if (!function_exists('imagecreatefromstring')) return;             // GD unavailable

            $disk = Storage::disk('public');
            if (!$disk->exists($relativePath)) return;

            $src = @imagecreatefromstring($disk->get($relativePath));
            if (!$src) return;

            $w = imagesx($src);
            $h = imagesy($src);
            $hasAlpha = ($ext === 'png');
            $darkPath = self::darkPath($relativePath);

            if (!self::isOnLightBackdrop($src, $hasAlpha, $w, $h)) {
                // Full-bleed coloured background — keep the logo unchanged.
                imagealphablending($src, false);
                imagesavealpha($src, true);
                $disk->put($darkPath, self::toPng($src));
                imagedestroy($src);
                return;
            }

            // White / transparent backdrop — strip background, lighten dark ink,
            // keep coloured pixels so brand colours survive on the dark nav.
            $out = imagecreatetruecolor($w, $h);
            imagealphablending($out, false);
            imagesavealpha($out, true);
            imagefilledrectangle($out, 0, 0, $w, $h, imagecolorallocatealpha($out, 0, 0, 0, 127));
            for ($y = 0; $y < $h; $y++) {
                for ($x = 0; $x < $w; $x++) {
                    $c = imagecolorat($src, $x, $y);
                    $a = $hasAlpha ? (($c >> 24) & 0x7F) : 0;
                    if ($a >= 120) continue;                 // already transparent
                    $r = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
                    if (min($r, $g, $b) >= 246) continue;    // near-white bg -> transparent
                    $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                    if ($lum < 95) { $r = $g = $b = 255; }   // dark ink -> white
                    $col = imagecolorallocatealpha($out, $r, $g, $b, $a);
                    imagesetpixel($out, $x, $y, $col);
                    imagecolordeallocate($out, $col);
                }
            }
            $disk->put($darkPath, self::toPng($out));
            imagedestroy($src);
            imagedestroy($out);
        } catch (\Throwable $e) {
            report($e); // swallow — never block the upload
        }
    }

    /** Remove the dark variant beside a logo (call before deleting the logo). */
    public static function delete(?string $relativePath): void
    {
        try {
            if (!$relativePath) return;
            $darkPath = self::darkPath($relativePath);
            if ($darkPath && $darkPath !== $relativePath) {
                Storage::disk('public')->delete($darkPath);
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }

    private static function darkPath(string $relativePath): string
    {
        return preg_replace('/\.(png|jpe?g|webp)$/i', '-dark.png', $relativePath);
    }

    /** True when the logo's border is mostly white/transparent (>=70%). */
    private static function isOnLightBackdrop($im, bool $hasAlpha, int $w, int $h): bool
    {
        $light = 0; $n = 0; $pts = [];
        for ($i = 0; $i <= 10; $i++) { $x = (int) ($i * ($w - 1) / 10); $pts[] = [$x, 0]; $pts[] = [$x, $h - 1]; }
        for ($i = 0; $i <= 10; $i++) { $y = (int) ($i * ($h - 1) / 10); $pts[] = [0, $y]; $pts[] = [$w - 1, $y]; }
        foreach ($pts as $p) {
            $c = imagecolorat($im, $p[0], $p[1]);
            $a = $hasAlpha ? (($c >> 24) & 0x7F) : 0;
            $r = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
            if ($a >= 120 || min($r, $g, $b) >= 240) $light++;
            $n++;
        }
        return $n > 0 && ($light / $n) >= 0.7;
    }

    private static function toPng($im): string
    {
        ob_start();
        imagepng($im);
        return (string) ob_get_clean();
    }
}
