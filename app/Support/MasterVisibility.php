<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class MasterVisibility
{
    private const TIER_SUPER  = 5;
    private const TIER_CLIENT = 4;
    private const TIER_BRANCH = 2;
    private const TIER_NONE   = 0;

    public static function applyReadScope(Builder $q, $user, ?int $branchFilter = null): void
    {
        if (!$user) {
            $q->whereRaw('1 = 0');
            return;
        }

        if (($user->user_type ?? null) === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        $clientId = $user->client_id ?? optional($user->branch ?? null)->client_id;

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
            self::applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (($user->user_type ?? null) === 'employee') {
            $table = $q->getModel()->getTable();
            if (str_starts_with($table, 'master_') || str_starts_with($table, 'clm_')) {
                self::applyBranchScope($q, $user);
                return;
            }

            $userId = (int) $user->id;

            $q->where(function ($w) use ($clientId, $userId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $userId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($userId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('created_by', $userId);
                         });
                  });
            });
            return;
        }

        if (($user->user_type ?? null) === 'branch_user') {
            self::applyBranchScope($q, $user);
            return;
        }

        $q->whereRaw('1 = 0');
    }

    public static function applyBranchScope(Builder $q, $user): void
    {
        if (!$user) {
            $q->whereRaw('1 = 0');
            return;
        }
        $clientId = $user->client_id ?? optional($user->branch ?? null)->client_id;
        $branchId = $user->branch_id;

        $q->where(function ($w) use ($clientId, $branchId) {
            $w->whereNull('client_id')
              ->orWhere(function ($ww) use ($clientId, $branchId) {
                  $ww->where('client_id', $clientId)
                     ->where(function ($wb) use ($branchId) {
                         $wb->whereNull('branch_id')
                            ->orWhere('branch_id', $branchId);
                     });
              });
        });
    }

    public static function hierarchicalDenial(?User $user, $row, string $action): ?string
    {
        if (!$user || $user->user_type === 'super_admin') return null;

        if ($row instanceof \App\Models\Customer
            || $row instanceof \App\Models\Consignee
            || $row instanceof \App\Models\Vendor) {
            return null;
        }

        $clmMasters = [
            \App\Models\ClmTradeDocLibrary::class,   \App\Models\ClmTradeDocName::class,
            \App\Models\ClmAgreementLibrary::class,  \App\Models\ClmAgreementType::class,
            \App\Models\ClmClauseLibrary::class,     \App\Models\ClmClauseType::class,
            \App\Models\ClmTncLibrary::class,        \App\Models\ClmTncCategory::class,
            \App\Models\ClmSegmentRule::class,
        ];
        foreach ($clmMasters as $cls) {
            if ($row instanceof $cls) return null;
        }

        $isOwnRow = isset($row->created_by) && $row->created_by
            && (int) $row->created_by === (int) $user->id;
        if ($isOwnRow) return null;

        if (($user->user_type ?? null) === 'employee'
            && !($row instanceof \App\Models\Masters\ExpenseCategories)) {
            $verb = $action === 'delete' ? 'delete' : 'edit';
            return "You cannot {$verb} this record — employees can only manage rows they created themselves.";
        }

        $userTier = self::tierFor($user);

        $rowClientId = $row->client_id ?? null;
        $rowBranchId = $row->branch_id ?? null;

        if (!$rowClientId) {
            $rowTier = self::TIER_SUPER;
            $defaultLabel = 'a Super Admin';
        } elseif (!$rowBranchId) {
            $rowTier = self::TIER_CLIENT;
            $defaultLabel = 'a Client user';
        } else {
            $rowTier = self::TIER_BRANCH;
            $defaultLabel = 'another Branch';
        }

        $creator = (isset($row->created_by) && $row->created_by)
            ? User::find($row->created_by)
            : null;

        $rowLabel = $creator ? match ($creator->user_type) {
            'super_admin'             => 'a Super Admin',
            'client_admin'            => 'a Client Admin',
            'client_user'             => 'a Client user',
            'branch_user', 'employee' => $rowTier === self::TIER_BRANCH
                ? 'another Branch'
                : $defaultLabel,
            default                   => $defaultLabel,
        } : $defaultLabel;

        if ($rowTier <= $userTier) return null;

        $verb = $action === 'delete' ? 'delete' : 'edit';
        return "You cannot {$verb} this record — it was created by {$rowLabel}.";
    }

    private static function applySwitcherBranchFilter(Builder $q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    private static function tierFor(?User $u): int
    {
        if (!$u) return self::TIER_NONE;
        return match ($u->user_type) {
            'super_admin'                  => self::TIER_SUPER,
            'client_admin', 'client_user'  => self::TIER_CLIENT,
            'branch_user', 'employee'      => self::TIER_BRANCH,
            default                        => self::TIER_NONE,
        };
    }
}
