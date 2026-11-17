<?php

namespace App\Support;

use App\Models\Masters\Currencies;

final class SupplierPricing
{
    public const DOMESTIC      = 'domestic';
    public const INTERNATIONAL = 'international';
    public const ORIGINS       = [self::DOMESTIC, self::INTERNATIONAL];

    public const GST_INTRA = 'intra';
    public const GST_INTER = 'inter';
    public const GST_NONE  = 'none';

    public const COUNTRY_CURRENCY = [
        'uae' => 'AED', 'united arab emirates' => 'AED',
        'usa' => 'USD', 'united states' => 'USD', 'united states of america' => 'USD',
        'germany' => 'EUR', 'netherlands' => 'EUR', 'italy' => 'EUR', 'france' => 'EUR', 'spain' => 'EUR',
        'united kingdom' => 'GBP', 'uk' => 'GBP',
        'singapore' => 'SGD', 'china' => 'CNY', 'japan' => 'JPY', 'south korea' => 'KRW',
        'saudi arabia' => 'SAR', 'oman' => 'OMR', 'malaysia' => 'MYR', 'vietnam' => 'USD',
    ];

    public static function isInternational(?string $country): bool
    {
        $c = trim((string) $country);
        return $c !== '' && strcasecmp($c, 'India') !== 0;
    }

    public static function originOf(?string $country): string
    {
        return self::isInternational($country) ? self::INTERNATIONAL : self::DOMESTIC;
    }

    public static function currencyFor(?string $country): string
    {
        if (!self::isInternational($country)) return 'INR';
        return self::COUNTRY_CURRENCY[mb_strtolower(trim((string) $country))] ?? 'USD';
    }

    public static function defaultRate(string $code, $user): ?float
    {
        $row = Currencies::query()
            ->whereRaw('UPPER(code) = ?', [strtoupper($code)])
            ->whereRaw('LOWER(status) = ?', ['active'])
            ->tap(fn ($q) => MasterVisibility::applyReadScope($q, $user))
            ->orderByRaw('client_id IS NULL')
            ->first(['exchange_rate']);
        $rate = $row ? (float) $row->exchange_rate : 0.0;
        return $rate > 0 ? $rate : null;
    }

    public static function gstTypeFor(?string $supplierState, ?string $supplierStateCode, ?string $ourState, ?string $ourStateCode): string
    {
        $a = trim((string) $supplierStateCode); $b = trim((string) $ourStateCode);
        if ($a !== '' && $b !== '') return strcasecmp($a, $b) === 0 ? self::GST_INTRA : self::GST_INTER;
        $s = trim((string) $supplierState); $o = trim((string) $ourState);
        return ($s !== '' && $o !== '' && strcasecmp($s, $o) === 0) ? self::GST_INTRA : self::GST_INTER;
    }

    public static function domestic(float $price, float $gstPct, string $gstType = self::GST_INTER): array
    {
        $price = round($price, 2);
        $gst   = round($price * $gstPct / 100, 2);
        $half  = round($gst / 2, 2);
        $intra = $gstType === self::GST_INTRA;
        $total = round($price + $gst, 2);
        return [
            'origin'         => self::DOMESTIC,
            'currency_code'  => 'INR',
            'exchange_rate'  => null,
            'price'          => $price,
            'gst_percentage' => $gstPct,
            'gst_type'       => $intra ? self::GST_INTRA : self::GST_INTER,
            'cgst_amount'    => $intra ? $half : 0,
            'sgst_amount'    => $intra ? round($gst - $half, 2) : 0,
            'igst_amount'    => $intra ? 0 : $gst,
            'gst_amount'     => $gst,
            'total_amount'   => $total,
            'inr_amount'     => $total,
        ];
    }

    public static function international(float $price, string $currency, float $rate): array
    {
        $price = round($price, 2);
        return [
            'origin'         => self::INTERNATIONAL,
            'currency_code'  => strtoupper($currency),
            'exchange_rate'  => round($rate, 4),
            'price'          => $price,
            'gst_percentage' => 0,
            'gst_type'       => self::GST_NONE,
            'cgst_amount'    => 0,
            'sgst_amount'    => 0,
            'igst_amount'    => 0,
            'gst_amount'     => 0,
            'total_amount'   => $price,
            'inr_amount'     => round($price * $rate, 2),
        ];
    }

    public static function vsTarget(?float $unitInr, ?float $target): ?array
    {
        if (!$unitInr || !$target || $target <= 0) return null;
        $pct = round(($unitInr - $target) / $target * 100, 2);
        return [
            'target'     => round($target, 2),
            'difference' => round($unitInr - $target, 2),
            'percent'    => abs($pct),
            'status'     => abs($pct) < 0.005 ? 'at' : ($pct < 0 ? 'below' : 'above'),
        ];
    }
}
