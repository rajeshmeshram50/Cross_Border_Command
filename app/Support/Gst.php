<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\Masters\StateCodes;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

final class Gst
{
    public const DOMESTIC_COUNTRY = 'India';

    public const DEFAULT_HOME_STATE_CODE = '27';

    public static function isDomestic(?string $country): bool
    {
        return trim((string) $country) === self::DOMESTIC_COUNTRY;
    }

    public static function applicableFor(?string $country): string
    {
        return self::isDomestic($country) ? 'Yes' : 'No';
    }

    public static function stateCodeFor(?string $stateName, $user = null): ?string
    {
        $name = trim((string) $stateName);
        if ($name === '') return null;

        $user     = $user ?: Auth::user();
        $clientId = $user?->client_id ?? optional($user?->branch)->client_id;
        $branchId = $user?->branch_id;

        $code = StateCodes::query()
            ->from('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->whereRaw('LOWER(sc.status) = ?', ['active'])
            ->whereRaw('LOWER(s.name) = ?', [mb_strtolower($name)])
            ->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('sc.client_id');
                if ($clientId !== null) {
                    $w->orWhere(function ($ww) use ($clientId, $branchId) {
                        $ww->where('sc.client_id', $clientId)
                            ->where(function ($wb) use ($branchId) {
                                $wb->whereNull('sc.branch_id');
                                if ($branchId !== null) $wb->orWhere('sc.branch_id', $branchId);
                            });
                    });
                }
            })
            ->orderByRaw('CASE WHEN sc.client_id IS NULL THEN 0 WHEN sc.branch_id IS NULL THEN 1 ELSE 2 END')
            ->orderBy('sc.id')
            ->value('sc.state_code');

        return $code !== null ? (string) $code : null;
    }

    public static function stateCodeFromGstin(?string $gstin): ?string
    {
        $v = strtoupper(trim((string) $gstin));
        return preg_match('/^[0-9]{2}/', $v) ? substr($v, 0, 2) : null;
    }

    public static function homeStateCode(?int $branchId): string
    {
        $branch = $branchId ? Branch::find($branchId) : null;
        $code = trim((string) (optional($branch)->gst_state_code ?: ''));
        if ($code === '') {
            $code = (string) (self::stateCodeFromGstin(optional($branch)->gst_number) ?? '');
        }

        return $code !== '' ? $code : self::DEFAULT_HOME_STATE_CODE;
    }
}
