<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * Version stamp for the form-bundle server caches (Customer / Consignee,
 * Product, Vendor, Client, Branch).
 *
 * Those bundles are cached per-user for 5 minutes via Cache::remember to keep
 * the dropdown payloads off the DB on every form open. The problem: when a
 * master row (risk level, segment, designation …) is added or edited, every
 * user's cached bundle is stale until its TTL lapses — so the new entry
 * doesn't appear in the dropdowns for up to 5 minutes.
 *
 * Enumerating + forgetting every per-user key isn't possible on the file/
 * database cache drivers (no tag support). Instead we fold a monotonic
 * version number into each cache key. Bumping the version on any master
 * write orphans every existing key at once (they expire naturally via TTL)
 * and the next request recomputes fresh — one rebuild per user per bundle,
 * not a recompute on every request. The cache keeps protecting the API.
 */
class MasterBundleCache
{
    private const VERSION_KEY = 'master-bundle:version';

    /** Current cache version. Defaults to 0 before the first bump. */
    public static function version(): int
    {
        return (int) Cache::get(self::VERSION_KEY, 0);
    }

    /**
     * Build a version-stamped, per-user cache key for a bundle.
     * e.g. key('customer:master-bundle', 7) => 'customer:master-bundle:user:7:v3'
     */
    public static function key(string $base, $userId): string
    {
        return $base . ':user:' . ($userId ?? 'guest') . ':v' . self::version();
    }

    /**
     * Invalidate every bundle cache by advancing the version. Call after any
     * master create/update/delete. Cheap (one cache write) and never touches
     * the DB. Read-modify-write rather than Cache::increment so it works
     * uniformly across the file/database/array drivers.
     */
    public static function bump(): void
    {
        Cache::forever(self::VERSION_KEY, self::version() + 1);
    }
}
