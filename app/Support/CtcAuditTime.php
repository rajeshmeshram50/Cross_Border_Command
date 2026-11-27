<?php

namespace App\Support;

use Illuminate\Support\Carbon;

class CtcAuditTime
{
    public const DISPLAY_TZ = 'Asia/Kolkata';

    public static function str(?string $s): string
    {
        if ($s === null || $s === '' || $s === '—') return $s ?? '—';
        try {
            $hasTime = (bool) preg_match('/\d{1,2}:\d{2}/', $s);
            $c = Carbon::parse($s, 'UTC')->setTimezone(self::DISPLAY_TZ);
            return $hasTime ? $c->format('d M Y H:i') : $c->format('d M Y');
        } catch (\Throwable $e) {
            return $s;
        }
    }

    public static function entries($arr): array
    {
        return array_map(function ($e) {
            if (is_array($e)) {
                foreach (['date', 'acted_at', 'response_date'] as $k) {
                    if (!empty($e[$k])) $e[$k] = self::str($e[$k]);
                }
            }
            return $e;
        }, array_values($arr ?? []));
    }
}
