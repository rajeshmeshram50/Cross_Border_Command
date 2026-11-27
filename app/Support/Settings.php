<?php

namespace App\Support;

use App\Models\PlatformSetting;
use Illuminate\Support\Facades\Cache;

class Settings
{
    private const CACHE_KEY = 'platform_settings_cached_v1';
    private const CACHE_TTL = 60;

    public static function all(): array
    {
        return Cache::remember(self::CACHE_KEY, self::CACHE_TTL, function () {
            $rows = PlatformSetting::all(['section', 'value']);
            $out = [];
            foreach ($rows as $r) $out[$r->section] = $r->value;
            return $out;
        });
    }

    public static function bust(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    public static function section(string $section): array
    {
        return self::all()[$section] ?? [];
    }

    public static function is(string $section, string $key, bool $default = false): bool
    {
        return (bool) (self::section($section)[$key] ?? $default);
    }

    public static function shouldSendMail(?string $category = null): bool
    {
        if (!self::is('notifications', 'emailNotif', true)) return false;
        if ($category && !self::is('notifications', $category, true)) return false;
        return true;
    }
}
