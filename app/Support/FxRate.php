<?php

namespace App\Support;

final class FxRate
{
    public const MAX = 10000;

    public static function rules(bool $required = false): array
    {
        return [
            $required ? 'required' : 'nullable',
            'numeric',
            'gt:0',
            'max:' . self::MAX,
        ];
    }

    public static function messages(string $field = 'exchange_rate'): array
    {
        return [
            "{$field}.gt"  => 'Exchange rate must be greater than 0.',
            "{$field}.max" => 'Exchange rate looks wrong — the highest allowed is '
                . number_format(self::MAX) . '. Check for a misplaced decimal.',
        ];
    }
}
