<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

class LogoDarkVariantGenerator
{
    private const LOGO_TRANSPARENCY = 0.30;

    public static function generate(?string $relativePath): void
    {
        try {
            if (!$relativePath) return;
            $ext = strtolower(pathinfo($relativePath, PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) return;
            if (!function_exists('imagecreatefromstring')) return;

            $disk = Storage::disk('public');
            if (!$disk->exists($relativePath)) return;

            $src = @imagecreatefromstring($disk->get($relativePath));
            if (!$src) return;
            if (function_exists('imagepalettetotruecolor')) { imagepalettetotruecolor($src); }
            imagesavealpha($src, true);

            $w = imagesx($src);
            $h = imagesy($src);
            $hasAlpha = ($ext === 'png');
            $darkPath = self::darkPath($relativePath);
            $total = max(1, $w * $h);

            $out = imagecreatetruecolor($w, $h);
            imagealphablending($out, false);
            imagesavealpha($out, true);
            imagefilledrectangle($out, 0, 0, $w, $h, imagecolorallocatealpha($out, 0, 0, 0, 127));
            $transparent = 0;
            for ($y = 0; $y < $h; $y++) {
                for ($x = 0; $x < $w; $x++) {
                    $c = imagecolorat($src, $x, $y);
                    $a = $hasAlpha ? (($c >> 24) & 0x7F) : 0;
                    if ($a >= 120) { $transparent++; continue; }
                    $r = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
                    if (min($r, $g, $b) >= 240) { $transparent++; continue; }
                    $chroma = max($r, $g, $b) - min($r, $g, $b);
                    $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                    if ($chroma < 40) {
                        if ($lum >= 210) { $transparent++; continue; }
                        $r = $g = $b = 255;
                        $a = $lum <= 110 ? 0 : (int) round(($lum - 110) / (210 - 110) * 110);
                    }
                    $col = imagecolorallocatealpha($out, $r, $g, $b, $a);
                    imagesetpixel($out, $x, $y, $col);
                    imagecolordeallocate($out, $col);
                }
            }

            if ($transparent / $total >= self::LOGO_TRANSPARENCY) {
                $disk->put($darkPath, self::toPng($out));
                imagedestroy($src);
                imagedestroy($out);
                return;
            }
            imagedestroy($out);

            if (self::borderIsLight($src, $hasAlpha, $w, $h)) {
                $hi = 224; $lo = 196;
                $lit = imagecreatetruecolor($w, $h);
                imagealphablending($lit, false);
                imagesavealpha($lit, true);
                imagefilledrectangle($lit, 0, 0, $w, $h, imagecolorallocatealpha($lit, 0, 0, 0, 127));
                for ($y = 0; $y < $h; $y++) {
                    for ($x = 0; $x < $w; $x++) {
                        $c = imagecolorat($src, $x, $y);
                        $a = $hasAlpha ? (($c >> 24) & 0x7F) : 0;
                        if ($a >= 120) continue;
                        $r = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
                        $lum = 0.299 * $r + 0.587 * $g + 0.114 * $b;
                        if ($lum >= $hi) continue;
                        $alpha = $lum <= $lo ? 0 : (int) round(($lum - $lo) / ($hi - $lo) * 127);
                        $col = imagecolorallocatealpha($lit, $r, $g, $b, $alpha);
                        imagesetpixel($lit, $x, $y, $col);
                        imagecolordeallocate($lit, $col);
                    }
                }
                $disk->put($darkPath, self::toPng($lit));
                imagedestroy($src);
                imagedestroy($lit);
                return;
            }

            imagealphablending($src, false);
            imagesavealpha($src, true);
            $disk->put($darkPath, self::toPng($src));
            imagedestroy($src);
        } catch (\Throwable $e) {
            report($e);
        }
    }

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

    private static function borderIsLight($im, bool $hasAlpha, int $w, int $h): bool
    {
        $inX = max(1, (int) round($w * 0.05));
        $inY = max(1, (int) round($h * 0.05));
        $x0 = $inX; $x1 = $w - 1 - $inX; $y0 = $inY; $y1 = $h - 1 - $inY;
        if ($x1 <= $x0 || $y1 <= $y0) { $x0 = 0; $x1 = $w - 1; $y0 = 0; $y1 = $h - 1; }
        $light = 0; $n = 0; $pts = [];
        for ($i = 0; $i <= 10; $i++) { $x = (int) ($x0 + $i * ($x1 - $x0) / 10); $pts[] = [$x, $y0]; $pts[] = [$x, $y1]; }
        for ($i = 0; $i <= 10; $i++) { $y = (int) ($y0 + $i * ($y1 - $y0) / 10); $pts[] = [$x0, $y]; $pts[] = [$x1, $y]; }
        foreach ($pts as $p) {
            $c = imagecolorat($im, $p[0], $p[1]);
            $a = $hasAlpha ? (($c >> 24) & 0x7F) : 0;
            $r = ($c >> 16) & 0xFF; $g = ($c >> 8) & 0xFF; $b = $c & 0xFF;
            if ($a >= 120 || (0.299 * $r + 0.587 * $g + 0.114 * $b) >= 200) $light++;
            $n++;
        }
        return $n > 0 && ($light / $n) >= 0.6;
    }

    private static function toPng($im): string
    {
        ob_start();
        imagepng($im);
        return (string) ob_get_clean();
    }
}
