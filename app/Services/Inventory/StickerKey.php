<?php

namespace App\Services\Inventory;

class StickerKey
{
    public const PATH = '/ps/';

    private const PATH_RE = '#/p?s/#';

    private const KINDS = ['RC' => 'RACK', 'SH' => 'SHELF', 'ZN' => 'ZONE', 'WH' => 'WAREHOUSE'];

    public static function url(string $type, int|string $id, int|string $tenant): string
    {
        $base = rtrim((string) (config('inventory.sticker_url') ?: config('app.url')), '/');

        return $base . self::PATH . str_replace('|', '.', self::key($type, $id, $tenant));
    }

    public static function fromShort(?string $scan, int|string|null $tenant): ?string
    {
        if (!$scan || $tenant === null) return null;

        if (!preg_match('/^([A-Z]{2}):(\d+)$/i', trim($scan), $m)) return null;

        $kind = strtoupper($m[1]);

        return isset(self::KINDS[$kind]) ? self::url(self::KINDS[$kind], (int) $m[2], $tenant) : null;
    }

    public static function key(string $type, int|string $id, int|string $tenant): string
    {
        $body = implode('|', ['CBC1', $tenant, strtoupper($type), $id, self::nonce($type, $id, $tenant)]);

        return $body . '|' . self::sign($body);
    }

    public static function parse(string $raw): ?array
    {
        $s = trim($raw);

        if (preg_match(self::PATH_RE, $s, $m, PREG_OFFSET_CAPTURE)) {
            $s = substr($s, $m[0][1] + strlen($m[0][0]));
        }

        $s = rtrim(preg_split('/[?#]/', $s)[0], '/');

        if (!str_contains($s, '|') && str_contains($s, '.')) {
            $s = str_replace('.', '|', $s);
        }

        $parts = explode('|', strtoupper($s));
        if (count($parts) !== 6 || $parts[0] !== 'CBC1') return null;

        [, $tenant, $type, $id, , $sig] = $parts;
        $body = implode('|', array_slice($parts, 0, 5));

        $valid  = hash_equals(self::sign($body), $sig);
        $legacy = !$valid
            && config('inventory.sticker_accept_legacy', true)
            && hash_equals(self::signLegacy($body), $sig);

        return [
            'tenant' => $tenant,
            'type'   => strtoupper($type),
            'id'     => $id,
            'valid'  => $valid || $legacy,
            'legacy' => $legacy,
        ];
    }

    public static function idFor(string $raw, string ...$types): ?int
    {
        $p = self::parse($raw);

        return $p && in_array($p['type'], array_map('strtoupper', $types), true) && ctype_digit($p['id'])
            ? (int) $p['id']
            : null;
    }

    private static function sign(string $body): string
    {
        $mac = hash_hmac('sha256', $body, self::keyBytes(), true);

        return substr(self::b32($mac), 0, 16);
    }

    private static function keyBytes(): string
    {
        $secret = trim((string) config('inventory.sticker_secret'));

        if ($secret === '' || $secret === 'demo-signing-secret') {
            $secret = (string) config('app.key');
        }

        if (str_starts_with($secret, 'base64:')) {
            $secret = (string) base64_decode(substr($secret, 7), true);
        }

        if ($secret === '') {
            throw new \RuntimeException('Sticker signing needs STICKER_SECRET or APP_KEY.');
        }

        return hash_hkdf('sha256', $secret, 32, 'cbc-sticker-hmac-v2');
    }

    private static function signLegacy(string $body): string
    {
        $h = self::fold($body . '|' . (config('inventory.sticker_secret') ?: 'demo-signing-secret'), 0x811c9dc5);

        return substr(str_pad(self::b36($h), 7, '0', STR_PAD_LEFT), -7);
    }

    private static function nonce(string $type, int|string $id, int|string $tenant): string
    {
        $h = self::fold("{$tenant}:" . strtoupper($type) . ":{$id}", 0x2166136f);

        return substr(str_pad(self::b36($h), 5, '0', STR_PAD_LEFT), 0, 5);
    }

    private static function fold(string $s, int $basis): int
    {
        $h = $basis;
        for ($i = 0, $n = strlen($s); $i < $n; $i++) {
            $h ^= ord($s[$i]);
            $h = ($h * 0x01000193) & 0xFFFFFFFF;
        }

        return $h;
    }

    private static function b36(int $h): string
    {
        return strtoupper(base_convert((string) $h, 10, 36));
    }

    private static function b32(string $raw): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        for ($i = 0, $n = strlen($raw); $i < $n; $i++) {
            $bits .= str_pad(decbin(ord($raw[$i])), 8, '0', STR_PAD_LEFT);
        }

        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            if (strlen($chunk) < 5) break;
            $out .= $alphabet[bindec($chunk)];
        }

        return $out;
    }
}
