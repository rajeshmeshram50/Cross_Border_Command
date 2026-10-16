<?php

namespace App\Services\Inventory;

/**
 * The payload printed on every label — box stickers and location labels alike.
 *
 *     https://host/s/CBC1.<tenant>.<TYPE>.<id>.<nonce>.<signature>
 *
 * A URL rather than bare text, and that is the whole point. A stranger's phone
 * decodes a bare string and shows it to them; it decodes a URL and OPENS it,
 * which puts the scan on our server, where a request with no device credential
 * is answered with "Device blocked". The code stays readable by anything — it
 * just leads somewhere that refuses.
 *
 * Dots on the wire instead of pipes, so the key rides in a URL path without
 * percent-escaping, which would otherwise make the printed code bigger.
 *
 * The id, never the code. A box id is unique across every invoice; B-001
 * exists on almost every SPI. Location codes restart at 001 per branch.
 *
 * Mirrors makeKey()/makeSticker() in resources/js/pages/inventory/putAwayStore.ts.
 * The signature there is an FNV-1a fold, not an HMAC, and this reproduces it
 * exactly so a PHP-printed label validates in that scanner. When the real
 * server-side signing lands, both sides change together.
 */
class StickerKey
{
    /**
     * Our own path, separate from the Inventory Management simulation.
     *
     * '/s/' belongs to that module's demo landing page, which answers a scan
     * against hardcoded sample data and then bounces to /inventory. Sharing
     * the path would send every real carton into the simulation. '/ps/' lands
     * on the put-away scan page instead, and the two cannot collide.
     */
    public const PATH = '/ps/';

    /** Both paths are READ, so labels already printed with '/s/' still work. */
    private const PATH_RE = '#/p?s/#';

    /** Short label kinds, as they appear in the DB-facing code. */
    private const KINDS = ['RC' => 'RACK', 'SH' => 'SHELF', 'ZN' => 'ZONE', 'WH' => 'WAREHOUSE'];

    /** The full URL that goes into the QR. */
    public static function url(string $type, int|string $id, int|string $tenant): string
    {
        $base = rtrim((string) (config('inventory.sticker_url') ?: config('app.url')), '/');

        return $base . self::PATH . str_replace('|', '.', self::key($type, $id, $tenant));
    }

    /**
     * The URL for a location, from the short scan value its label already
     * carries — 'SH:41', 'RC:7', 'ZN:14'. Null for anything else, so a caller
     * with no usable value prints what it printed before.
     */
    public static function fromShort(?string $scan, int|string|null $tenant): ?string
    {
        if (!$scan || $tenant === null) return null;

        if (!preg_match('/^([A-Z]{2}):(\d+)$/i', trim($scan), $m)) return null;

        $kind = strtoupper($m[1]);

        return isset(self::KINDS[$kind]) ? self::url(self::KINDS[$kind], (int) $m[2], $tenant) : null;
    }

    /** The logical key, pipe-separated — what the validator works on. */
    public static function key(string $type, int|string $id, int|string $tenant): string
    {
        $body = implode('|', ['CBC1', $tenant, strtoupper($type), $id, self::nonce($type, $id, $tenant)]);

        return $body . '|' . self::sign($body);
    }

    /**
     * Read back anything a scanner might deliver — the printed URL, just the
     * path, the dot form, or the pipe form typed by hand.
     *
     * Returns null for a string that is not one of ours, so callers can fall
     * through to the older short forms ('SH:41') and to typed codes. Those
     * still exist on labels already stuck to racks.
     *
     * @return array{tenant:string,type:string,id:string,valid:bool}|null
     */
    public static function parse(string $raw): ?array
    {
        $s = trim($raw);

        // Either path, so a label printed before the split still resolves.
        if (preg_match(self::PATH_RE, $s, $m, PREG_OFFSET_CAPTURE)) {
            $s = substr($s, $m[0][1] + strlen($m[0][0]));
        }

        // Strip a query string, a fragment and any trailing slash.
        $s = rtrim(preg_split('/[?#]/', $s)[0], '/');

        if (!str_contains($s, '|') && str_contains($s, '.')) {
            $s = str_replace('.', '|', $s);
        }

        /* Upper-case the whole key before anything reads it. Every part is
           uppercase by construction — CBC1, digits, the type word, base36
           nonce and signature — so case carries no meaning and cannot be
           lost. Some scanner profiles lower-case what they type, and without
           this a perfectly good label fails its signature check. */
        $parts = explode('|', strtoupper($s));
        if (count($parts) !== 6 || $parts[0] !== 'CBC1') return null;

        [, $tenant, $type, $id, , $sig] = $parts;

        return [
            'tenant' => $tenant,
            'type'   => strtoupper($type),
            'id'     => $id,
            // Reported, not enforced here: refusing a scan is the caller's job,
            // and it needs to say WHY in its own words.
            'valid'  => hash_equals(self::sign(implode('|', array_slice($parts, 0, 5))), $sig),
        ];
    }

    /** The id a scan names, when it names one of this kind. */
    public static function idFor(string $raw, string ...$types): ?int
    {
        $p = self::parse($raw);

        return $p && in_array($p['type'], array_map('strtoupper', $types), true) && ctype_digit($p['id'])
            ? (int) $p['id']
            : null;
    }

    /* ─────────────────────────────── signing ─────────────────────────────── */

    private static function sign(string $body): string
    {
        $h = self::fold($body . '|' . config('inventory.sticker_secret'), 0x811c9dc5);

        return substr(str_pad(self::b36($h), 7, '0', STR_PAD_LEFT), -7);
    }

    /**
     * Derived from the item, not from a counter, so a label printed today
     * carries the same payload when it is reprinted tomorrow.
     */
    private static function nonce(string $type, int|string $id, int|string $tenant): string
    {
        $h = self::fold("{$tenant}:" . strtoupper($type) . ":{$id}", 0x2166136f);

        return substr(str_pad(self::b36($h), 5, '0', STR_PAD_LEFT), 0, 5);
    }

    /** FNV-1a, 32-bit. The multiply fits a 64-bit int exactly, then truncates. */
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
}
