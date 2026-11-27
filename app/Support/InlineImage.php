<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

class InlineImage
{
    public const MAX_WIDTH = 600;

    private const TTL = 3600;

    private const MISS_TTL = 300;

    private const MISS = '';

    public static function dataUri(?string $path, int $maxWidth = self::MAX_WIDTH): ?string
    {
        $path = trim((string) $path);
        if ($path === '' || str_starts_with($path, 'data:')) return null;

        $key = self::key($path, $maxWidth);

        $hit = Cache::get($key);
        if ($hit !== null) {
            return $hit === self::MISS ? null : $hit;
        }

        try {
            $raw = Storage::disk('public')->get($path);
            $uri = (is_string($raw) && $raw !== '') ? self::encode($raw, $maxWidth) : null;
        } catch (Throwable $e) {
            $uri = null;
        }

        Cache::put($key, $uri ?? self::MISS, $uri === null ? self::MISS_TTL : self::TTL);

        return $uri;
    }

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

        if ($w <= $maxWidth || $w < 1 || $h < 1 || !extension_loaded('gd')) {
            return 'data:' . $mime . ';base64,' . base64_encode($raw);
        }

        $src = @imagecreatefromstring($raw);
        if (!$src) return 'data:' . $mime . ';base64,' . base64_encode($raw);

        $nw = $maxWidth;
        $nh = max(1, (int) round($h * ($maxWidth / $w)));

        $dst = imagecreatetruecolor($nw, $nh);
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
