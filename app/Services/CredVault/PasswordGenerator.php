<?php

namespace App\Services\CredVault;

use App\Models\CredVault\Credential;

/**
 * Generate Password (CS-1430 … CS-1433) — characters or a passphrase, as the
 * R&D sheet specifies. Every pick is random_int(), PHP's CSPRNG, which draws
 * by rejection sampling: each character and each word is exactly equally
 * likely (GP-R1, GP-R2). The value is never stored or logged (GP-R6).
 *
 * Passphrases come from the EFF long list — 7,776 words, ≈ 12.9 bits a word —
 * resources/credvault/eff_large_wordlist.txt, © Electronic Frontier Foundation,
 * CC BY 3.0 (https://www.eff.org/dice), kept verbatim.
 */
class PasswordGenerator
{
    public const UPPER     = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    public const LOWER     = 'abcdefghijklmnopqrstuvwxyz';
    public const DIGITS    = '0123456789';
    public const SYMBOLS   = '!@#$%^&*-_=+?';
    /** Look-alikes left out when "Avoid ambiguous" is on: I O · l o · 0 1. */
    public const AMBIGUOUS = 'IOlo01';

    /** The generator's own defaults (D32 — no longer policies). */
    public const DEFAULTS = [
        'mode' => 'chars', 'length' => 20, 'upper' => true, 'lower' => true, 'numbers' => true, 'symbols' => true,
        'avoid_ambiguous' => true, 'words' => 6, 'capitalize' => true, 'add_number' => true, 'separator' => '-',
    ];
    public const LENGTH = [12, 64];
    public const WORDS  = [4, 10];
    public const SEPARATORS = ['-' => 'Hyphen', '.' => 'Dot', '_' => 'Underscore', ' ' => 'Space'];
    /** The separator by name — a bare " " is trimmed away by the request middleware, so "space" is how a space is sent. */
    public const SEPARATOR_NAMES = ['hyphen' => '-', 'dot' => '.', 'underscore' => '_', 'space' => ' '];

    private static ?array $words = null;

    /** The EFF long list, read once per process. */
    public static function wordList(): array
    {
        if (self::$words === null) {
            $lines = file(resource_path('credvault/eff_large_wordlist.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            self::$words = array_values(array_map(fn ($l) => trim(substr($l, strpos($l, "\t") + 1)), $lines));
        }
        return self::$words;
    }

    /** The chosen character sets, look-alikes removed when asked. @return string[] */
    public static function sets(array $o): array
    {
        $strip = fn (string $s) => $o['avoid_ambiguous'] ? str_replace(str_split(self::AMBIGUOUS), '', $s) : $s;

        return array_values(array_filter([
            $o['upper']   ? $strip(self::UPPER) : null,
            $o['lower']   ? $strip(self::LOWER) : null,
            $o['numbers'] ? $strip(self::DIGITS) : null,
            $o['symbols'] ? self::SYMBOLS : null,
        ]));
    }

    /**
     * The level a Characters setting always gives (D34) — known before anything is
     * generated, so a setting below the policy minimum is refused, not shown (GP-R4).
     * The length is at least 12, so letters + numbers + a symbol is always Strong.
     */
    public static function charsLevel(array $o): int
    {
        return ($o['upper'] || $o['lower']) && $o['numbers'] && $o['symbols'] ? 4 : 2;
    }

    /** Characters mode: one from every chosen set, the rest from all of them, then shuffled. */
    public static function characters(array $o): array
    {
        $sets = self::sets($o);
        $pool = implode('', $sets);
        $out  = array_map(fn ($s) => self::pick($s), $sets);                  // GP-R3 every set present
        while (count($out) < $o['length']) $out[] = self::pick($pool);
        self::shuffle($out);

        return ['password' => implode('', $out), 'bits' => $o['length'] * log(strlen($pool), 2)];
    }

    /**
     * Passphrase mode: N EFF words, capitalised, a digit on one word (always when the
     * policy minimum is Good or higher), joined by the separator — a hyphen, dot or
     * underscore is the special character; with a space one symbol is added to a word.
     */
    public static function passphrase(array $o, bool $digitRequired): array
    {
        $list  = self::wordList();
        $words = [];
        for ($i = 0; $i < $o['words']; $i++) $words[] = $list[random_int(0, count($list) - 1)];
        if ($o['capitalize']) $words = array_map('ucfirst', $words);

        $bits = $o['words'] * log(count($list), 2);
        if ($o['add_number'] || $digitRequired) {
            $words[random_int(0, count($words) - 1)] .= self::pick(self::DIGITS);
            $bits += log(10, 2);
        }
        if ($o['separator'] === ' ') {
            $words[random_int(0, count($words) - 1)] .= self::pick(self::SYMBOLS);
            $bits += log(strlen(self::SYMBOLS), 2);
        }

        return ['password' => implode($o['separator'], $words), 'bits' => $bits];
    }

    /** One character of $s, every one equally likely. */
    private static function pick(string $s): string
    {
        return $s[random_int(0, strlen($s) - 1)];
    }

    /** Fisher–Yates with the same source. */
    private static function shuffle(array &$a): void
    {
        for ($i = count($a) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$a[$i], $a[$j]] = [$a[$j], $a[$i]];
        }
    }

    /** The label for a level: Fair · Good · Strong (D34), none for an empty value. */
    public static function label(int $level): string
    {
        return Credential::STRENGTH_LABELS[$level] ?? '';
    }
}
