<?php

namespace App\Support;

use App\Models\PlatformSetting;
use Illuminate\Support\Facades\Cache;

/**
 * Tiny façade for reading platform_settings from anywhere in the codebase
 * without each caller pulling rows from the DB. Cached for 60 seconds —
 * SettingsController busts the cache on every save.
 *
 * Usage:
 *   if (Settings::shouldSendMail('newUser')) { Mail::to(...)->send(...); }
 *   if (Settings::is('security', 'bruteForce')) { ... }
 */
class Settings
{
    private const CACHE_KEY = 'platform_settings_cached_v1';
    private const CACHE_TTL = 60;

    /** Get the full settings map, cached. */
    public static function all(): array
    {
        return Cache::remember(self::CACHE_KEY, self::CACHE_TTL, function () {
            $rows = PlatformSetting::all(['section', 'value']);
            $out = [];
            foreach ($rows as $r) $out[$r->section] = $r->value;
            return $out;
        });
    }

    /** Force a refresh — call from SettingsController after a save. */
    public static function bust(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /** Read one section. */
    public static function section(string $section): array
    {
        return self::all()[$section] ?? [];
    }

    /** Read one boolean key with a sensible default. */
    public static function is(string $section, string $key, bool $default = false): bool
    {
        return (bool) (self::section($section)[$key] ?? $default);
    }

    /**
     * Single source of truth for "should we dispatch this email?".
     * Walks through:
     *   1. notifications.emailNotif (master gate — when off, NO emails at all)
     *   2. The specific category gate (newUser / planExp / payAlerts) when the
     *      caller passes one. If no category is given, only the master gate
     *      applies (used by OTP / password-changed mails which are always
     *      transactional and not user-toggleable).
     */
    public static function shouldSendMail(?string $category = null): bool
    {
        if (!self::is('notifications', 'emailNotif', true)) return false;
        if ($category && !self::is('notifications', $category, true)) return false;
        return true;
    }
}
