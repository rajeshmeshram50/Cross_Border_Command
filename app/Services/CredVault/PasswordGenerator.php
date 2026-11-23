<?php

namespace App\Services\CredVault;

use App\Models\CredVault\Credential;

class PasswordGenerator
{
    public const UPPER     = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    public const LOWER     = 'abcdefghijklmnopqrstuvwxyz';
    public const DIGITS    = '0123456789';
    public const SYMBOLS   = '!@#$%^&*-_=+?';
    public const AMBIGUOUS = 'IOlo01';

    public const DEFAULTS = [
        'mode' => 'chars', 'length' => 20, 'upper' => true, 'lower' => true, 'numbers' => true, 'symbols' => true,
        'avoid_ambiguous' => true, 'words' => 6, 'capitalize' => true, 'add_number' => true, 'separator' => '-',
    ];
    public const LENGTH = [12, 64];
    public const WORDS  = [4, 10];
    public const SEPARATORS = ['-' => 'Hyphen', '.' => 'Dot', '_' => 'Underscore', ' ' => 'Space'];
    public const SEPARATOR_NAMES = ['hyphen' => '-', 'dot' => '.', 'underscore' => '_', 'space' => ' '];

    private static ?array $words = null;

    public static function wordList(): array
    {
        if (self::$words === null) {
            $lines = file(resource_path('credvault/eff_large_wordlist.txt'), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            self::$words = array_values(array_map(fn ($l) => trim(substr($l, strpos($l, "\t") + 1)), $lines));
        }
        return self::$words;
    }

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

    public static function charsLevel(array $o): int
    {
        return ($o['upper'] || $o['lower']) && $o['numbers'] && $o['symbols'] ? 4 : 2;
    }

    public static function characters(array $o): array
    {
        $sets = self::sets($o);
        $pool = implode('', $sets);
        $out  = array_map(fn ($s) => self::pick($s), $sets);
        while (count($out) < $o['length']) $out[] = self::pick($pool);
        self::shuffle($out);

        return ['password' => implode('', $out), 'bits' => $o['length'] * log(strlen($pool), 2)];
    }

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

    private static function pick(string $s): string
    {
        return $s[random_int(0, strlen($s) - 1)];
    }

    private static function shuffle(array &$a): void
    {
        for ($i = count($a) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$a[$i], $a[$j]] = [$a[$j], $a[$i]];
        }
    }

    public static function label(int $level): string
    {
        return Credential::STRENGTH_LABELS[$level] ?? '';
    }
}
