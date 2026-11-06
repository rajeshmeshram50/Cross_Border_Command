<?php

namespace App\Services\CredVault;

use RuntimeException;

/**
 * Excel's own "Encrypt with Password" for an .xlsx (MS-OFFCRYPTO Agile
 * Encryption: AES-256-CBC, SHA-512, 100,000 spins), so a locked backup is an
 * .xlsx that Excel opens itself after asking for the password — no zip, which
 * Windows' built-in extractor cannot open when it is AES-encrypted.
 *
 * The result is a Compound File (OLE2) holding the EncryptionInfo and
 * EncryptedPackage streams plus the \x06DataSpaces storage Office writes.
 */
class ExcelLock
{
    private const SPIN = 100000;
    private const SEGMENT = 4096;

    private const BLK_VERIFIER_INPUT = "\xfe\xa7\xd2\x76\x3b\x4b\x9e\x79";
    private const BLK_VERIFIER_HASH  = "\xd7\xaa\x0f\x6d\x30\x61\x34\x4e";
    private const BLK_KEY_VALUE      = "\x14\x6e\x0b\xe7\xab\xac\xd0\xd6";
    private const BLK_HMAC_KEY       = "\x5f\xb2\xad\x01\x0c\xb9\xe1\xf6";
    private const BLK_HMAC_VALUE     = "\xa0\x67\x7f\x02\xb2\x2c\x84\x33";

    /** The .xlsx bytes, encrypted so only $password opens them. */
    public static function encrypt(string $xlsx, string $password): string
    {
        $secretKey = random_bytes(32);
        $keySalt   = random_bytes(16);
        $pwSalt    = random_bytes(16);

        // EncryptedPackage: the plain size, then 4096-byte segments, each with its own IV.
        $package = pack('P', strlen($xlsx));
        foreach (str_split($xlsx, self::SEGMENT) as $i => $seg) {
            $package .= self::aes($secretKey, self::iv($keySalt, pack('V', $i)), $seg);
        }

        // Data integrity: an HMAC of the whole package, its key and value encrypted with the secret key.
        $hmacKey = random_bytes(64);
        $encHmacKey   = self::aes($secretKey, self::iv($keySalt, self::BLK_HMAC_KEY), $hmacKey);
        $encHmacValue = self::aes($secretKey, self::iv($keySalt, self::BLK_HMAC_VALUE), hash_hmac('sha512', $package, $hmacKey, true));

        // The password key: SHA-512 over salt + UTF-16LE password, spun 100,000 times.
        $h = hash('sha512', $pwSalt . mb_convert_encoding($password, 'UTF-16LE', 'UTF-8'), true);
        for ($i = 0; $i < self::SPIN; $i++) $h = hash('sha512', pack('V', $i) . $h, true);
        $key = fn (string $blk) => substr(hash('sha512', $h . $blk, true), 0, 32);

        $verifier = random_bytes(16);
        $b64 = 'base64_encode';
        $info = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' . "\r\n"
            . '<encryption xmlns="http://schemas.microsoft.com/office/2006/encryption" xmlns:p="http://schemas.microsoft.com/office/2006/keyEncryptor/password" xmlns:c="http://schemas.microsoft.com/office/2006/keyEncryptor/certificate">'
            . '<keyData saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' . $b64($keySalt) . '"/>'
            . '<dataIntegrity encryptedHmacKey="' . $b64($encHmacKey) . '" encryptedHmacValue="' . $b64($encHmacValue) . '"/>'
            . '<keyEncryptors><keyEncryptor uri="http://schemas.microsoft.com/office/2006/keyEncryptor/password">'
            . '<p:encryptedKey spinCount="' . self::SPIN . '" saltSize="16" blockSize="16" keyBits="256" hashSize="64" cipherAlgorithm="AES" cipherChaining="ChainingModeCBC" hashAlgorithm="SHA512" saltValue="' . $b64($pwSalt) . '"'
            . ' encryptedVerifierHashInput="' . $b64(self::aes($key(self::BLK_VERIFIER_INPUT), $pwSalt, $verifier)) . '"'
            . ' encryptedVerifierHashValue="' . $b64(self::aes($key(self::BLK_VERIFIER_HASH), $pwSalt, hash('sha512', $verifier, true))) . '"'
            . ' encryptedKeyValue="' . $b64(self::aes($key(self::BLK_KEY_VALUE), $pwSalt, $secretKey)) . '"/>'
            . '</keyEncryptor></keyEncryptors></encryption>';

        return self::compoundFile([
            'EncryptionInfo'   => pack('vvV', 4, 4, 0x40) . $info,
            'EncryptedPackage' => $package,
            "\x06DataSpaces"   => [
                'Version'       => self::lp('Microsoft.Container.DataSpaces') . pack('v6', 1, 0, 1, 0, 1, 0),
                'DataSpaceMap'  => (function () {
                    $entry = pack('VV', 1, 0) . self::lp('EncryptedPackage') . self::lp('StrongEncryptionDataSpace');
                    return pack('VV', 8, 1) . pack('V', 4 + strlen($entry)) . $entry;
                })(),
                'DataSpaceInfo' => ['StrongEncryptionDataSpace' => pack('VV', 8, 1) . self::lp('StrongEncryptionTransform')],
                'TransformInfo' => ['StrongEncryptionTransform' => ["\x06Primary" => (function () {
                    $id = self::lp('{FF9A3F03-56EF-4613-BDD5-5A41C1D07246}');
                    return pack('VV', 8 + strlen($id), 1) . $id . self::lp('Microsoft.Container.EncryptionTransform')
                        . pack('v6', 1, 0, 1, 0, 1, 0) . pack('VVVV', 0, 0, 0, 4);
                })()]],
            ],
        ]);
    }

    /** AES-256-CBC without padding; the data is zero-filled to the 16-byte block. */
    private static function aes(string $key, string $iv, string $data): string
    {
        if ($r = strlen($data) % 16) $data .= str_repeat("\0", 16 - $r);
        $out = openssl_encrypt($data, 'aes-256-cbc', $key, OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING, $iv);
        if ($out === false) throw new RuntimeException('The backup could not be encrypted.');

        return $out;
    }

    private static function iv(string $salt, string $blk): string
    {
        return substr(hash('sha512', $salt . $blk, true), 0, 16);
    }

    /** UNICODE-LP-P4: byte length, UTF-16LE text, padded to 4 bytes. */
    private static function lp(string $s): string
    {
        $u = mb_convert_encoding($s, 'UTF-16LE', 'UTF-8');

        return pack('V', strlen($u)) . str_pad($u, (int) (ceil(strlen($u) / 4) * 4), "\0");
    }

    /* ═══════════════ Compound File (version 3, 512-byte sectors) ═══════════════ */

    private const FREE = 0xFFFFFFFF;
    private const END  = 0xFFFFFFFE;
    private const FAT  = 0xFFFFFFFD;
    private const CUTOFF = 4096;

    /**
     * @param array<string,string|array> $tree name => stream bytes, or name => [children] for a storage
     */
    private static function compoundFile(array $tree): string
    {
        // Flatten into directory entries: 0 is the Root Entry.
        $entries = [['name' => 'Root Entry', 'type' => 5, 'kids' => []]];
        $add = function (array $tree, int $parent) use (&$add, &$entries) {
            foreach ($tree as $name => $node) {
                $id = count($entries);
                $entries[] = is_array($node) ? ['name' => (string) $name, 'type' => 1, 'kids' => []] : ['name' => (string) $name, 'type' => 2, 'data' => $node];
                $entries[$parent]['kids'][] = $id;
                if (is_array($node)) $add($node, $id);
            }
        };
        $add($tree, 0);

        // Small streams go in the mini stream (64-byte sectors), the rest in regular sectors.
        $mini = '';
        $miniFat = [];
        foreach ($entries as &$e) {
            if ($e['type'] !== 2 || strlen($e['data']) >= self::CUTOFF) continue;
            $n = max(1, (int) ceil(strlen($e['data']) / 64));
            $e['start'] = count($miniFat);
            for ($i = 0; $i < $n; $i++) $miniFat[] = $i === $n - 1 ? self::END : count($miniFat) + 1;
            $mini .= str_pad($e['data'], $n * 64, "\0");
        }
        unset($e);

        $sectors = fn (int $bytes) => (int) ceil($bytes / 512);
        $dirN  = $sectors(count($entries) * 128);
        $mfN   = $sectors(count($miniFat) * 4);
        $msN   = $sectors(strlen($mini));
        $bigN  = 0;
        foreach ($entries as $e) if ($e['type'] === 2 && strlen($e['data']) >= self::CUTOFF) $bigN += $sectors(strlen($e['data']));
        $fatN = 1;
        while ($fatN * 128 < $fatN + $dirN + $mfN + $msN + $bigN) $fatN++;
        if ($fatN > 109) throw new RuntimeException('The backup is too large to lock.');

        // Layout: FAT, directory, mini FAT, mini stream, big streams — each a contiguous chain.
        $fat = array_fill(0, $fatN * 128, self::FREE);
        $next = 0;
        $chain = function (int $n) use (&$fat, &$next) {
            if ($n === 0) return self::END;
            $start = $next;
            for ($i = 0; $i < $n; $i++) $fat[$next + $i] = $i === $n - 1 ? self::END : $next + $i + 1;
            $next += $n;
            return $start;
        };
        for ($i = 0; $i < $fatN; $i++) $fat[$next++] = self::FAT;
        $dirStart = $chain($dirN);
        $mfStart  = $chain($mfN);
        $msStart  = $chain($msN);
        $body = '';
        foreach ($entries as &$e) {
            if ($e['type'] !== 2 || strlen($e['data']) < self::CUTOFF) continue;
            $e['start'] = $chain($sectors(strlen($e['data'])));
            $body .= str_pad($e['data'], $sectors(strlen($e['data'])) * 512, "\0");
        }
        unset($e);
        $entries[0]['start'] = $msStart;
        $entries[0]['data'] = $mini;

        // Each storage's children as a balanced tree (all black): shorter names first, then case-insensitive.
        $left = $right = $child = array_fill(0, count($entries), self::FREE);
        $cmp = function (int $a, int $b) use ($entries) {
            $x = mb_strtoupper($entries[$a]['name']);
            $y = mb_strtoupper($entries[$b]['name']);
            return [mb_strlen($x), $x] <=> [mb_strlen($y), $y];
        };
        $build = function (array $ids) use (&$build, &$left, &$right) {
            if (!$ids) return self::FREE;
            $m = intdiv(count($ids), 2);
            $left[$ids[$m]]  = $build(array_slice($ids, 0, $m));
            $right[$ids[$m]] = $build(array_slice($ids, $m + 1));
            return $ids[$m];
        };
        foreach ($entries as $id => $e) {
            if ($e['type'] === 2 || !$e['kids']) continue;
            $kids = $e['kids'];
            usort($kids, $cmp);
            $child[$id] = $build($kids);
        }

        $dir = '';
        foreach ($entries as $id => $e) {
            $name = mb_convert_encoding($e['name'], 'UTF-16LE', 'UTF-8') . "\0\0";
            $size = $e['type'] === 1 ? 0 : strlen($e['data']);
            $dir .= str_pad($name, 64, "\0") . pack('vCC', strlen($name), $e['type'], 1)
                . pack('VVV', $left[$id], $right[$id], $child[$id]) . str_repeat("\0", 16 + 4 + 16)
                . pack('VVV', $e['type'] === 1 || $size === 0 ? ($e['type'] === 5 ? self::END : 0) : $e['start'], $size, 0);
        }
        for ($i = count($entries); $i < $dirN * 4; $i++) {
            $dir .= str_repeat("\0", 64) . pack('vCC', 0, 0, 0) . pack('VVV', self::FREE, self::FREE, self::FREE) . str_repeat("\0", 48);
        }

        $difat = '';
        for ($i = 0; $i < 109; $i++) $difat .= pack('V', $i < $fatN ? $i : self::FREE);
        $header = "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" . str_repeat("\0", 16)
            . pack('vvvvv', 0x3E, 3, 0xFFFE, 9, 6) . str_repeat("\0", 6)
            . pack('VVVVVVVVV', 0, $fatN, $dirStart, 0, self::CUTOFF, $mfN ? $mfStart : self::END, $mfN, self::END, 0)
            . $difat;

        $miniFatBytes = '';
        foreach ($miniFat as $v) $miniFatBytes .= pack('V', $v);
        $fatBytes = '';
        foreach ($fat as $v) $fatBytes .= pack('V', $v);

        return $header . $fatBytes . $dir
            . ($mfN ? str_pad($miniFatBytes, $mfN * 512, "\xFF") : '')
            . ($msN ? str_pad($mini, $msN * 512, "\0") : '')
            . $body;
    }
}
