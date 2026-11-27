<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

class LogoWebVariantGenerator
{
    private const MAX_H = 160;

    private const MAX_W = 640;

    public static function generate(?string $relativePath): void
    {
        if (!$relativePath) return;
        self::one($relativePath);

        $dark = self::swapExt($relativePath, '-dark.png');
        if ($dark && Storage::disk('public')->exists($dark)) {
            self::one($dark);
        }
    }

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

    public static function webPath(?string $relativePath): ?string
    {
        if (!$relativePath) return null;
        if (!preg_match('/\.(png|jpe?g|webp)$/i', $relativePath, $m)) return null;

        return preg_replace('/\.(png|jpe?g|webp)$/i', '-w.' . strtolower($m[1]), $relativePath);
    }

    public static function existingWebPath(?string $relativePath): ?string
    {
        try {
            $web = self::webPath($relativePath);

            return ($web && Storage::disk('public')->exists($web)) ? $web : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private static function one(string $relativePath): void
    {
        try {
            $ext = strtolower(pathinfo($relativePath, PATHINFO_EXTENSION));
            if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) return;
            if (!function_exists('imagecreatefromstring')) return;

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
                $disk->put($out, $bytes);
                return;
            }

            $src = @imagecreatefromstring($bytes);
            if (!$src) return;
            if (function_exists('imagepalettetotruecolor')) { imagepalettetotruecolor($src); }

            $nw = max(1, (int) round($w * $scale));
            $nh = max(1, (int) round($h * $scale));

            $dst = imagecreatetruecolor($nw, $nh);
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefilledrectangle($dst, 0, 0, $nw, $nh, imagecolorallocatealpha($dst, 0, 0, 0, 127));
            imagealphablending($dst, true);
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
            imagealphablending($dst, false);

            $encoded = self::encode($dst, $ext);
            imagedestroy($src);
            imagedestroy($dst);

            $disk->put($out, ($encoded !== '' && strlen($encoded) < strlen($bytes)) ? $encoded : $bytes);
        } catch (\Throwable $e) {
            report($e);
        }
    }

    private static function swapExt(?string $relativePath, string $suffix): ?string
    {
        if (!$relativePath) return null;
        $swapped = preg_replace('/\.(png|jpe?g|webp)$/i', $suffix, $relativePath);

        return $swapped === $relativePath ? null : $swapped;
    }

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
