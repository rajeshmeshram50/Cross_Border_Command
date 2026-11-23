<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

class MasterBundleCache
{
    private const VERSION_KEY = 'master-bundle:version';

    public static function version(): int
    {
        return (int) Cache::get(self::VERSION_KEY, 0);
    }

    public static function key(string $base, $userId): string
    {
        return $base . ':user:' . ($userId ?? 'guest') . ':v' . self::version();
    }

    public static function bump(): void
    {
        Cache::forever(self::VERSION_KEY, self::version() + 1);
    }
}
