<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

/**
 * Centralised creator-hierarchy visibility + authorisation rules used by
 * master data and the dedicated Customer / Consignee / Product modules.
 *
 * Tenant tree (per client):
 *   Client
 *     └── Main Branch (is_main = true)
 *            ├── Main-branch members (branch_user + employee in main branch)
 *            └── Sub Branches (is_main = false)
 *                   └── Sub-branch members
 *
 * READ visibility — every row is visible to:
 *   - super_admin                         : all rows
 *   - client_admin / client_user          : their client's rows + globals
 *   - main-branch member                  : their client's rows + globals
 *   - sub-branch member                   : globals + client-level rows
 *                                           + main-branch rows
 *                                           + own sub-branch rows
 *                                           (sibling sub-branches blocked)
 *
 * MUTATE (edit/delete) — only the creator + ancestor branches can modify:
 *   - super_admin                         : any row
 *   - own row (created_by == auth)        : always allowed
 *   - else: viewer's tier must be >= creator's tier on the ladder
 *           super_admin > client > main-branch > sub-branch
 *
 * Branch users and employees share the same tier within a branch — there is
 * no sub-level between them, so same-branch colleagues can edit each
 * other's rows.
 */
class MasterVisibility
{
    private const TIER_SUPER  = 5;
    private const TIER_CLIENT = 4;
    private const TIER_MAIN   = 3;
    private const TIER_SUB    = 2;
    private const TIER_NONE   = 0;

    /**
     * Apply the standard creator-hierarchy READ scope to a query.
     *
     * `$branchFilter` is the BranchSwitcher's narrowing (only honoured for
     * roles that can switch — silently ignored for sub-branch users).
     */
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

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $isMain = $user->branch?->is_main ?? false;

            if ($isMain) {
                // Main-branch members see everything in their client.
                $q->where(function ($w) use ($clientId) {
                    $w->whereNull('client_id')->orWhere('client_id', $clientId);
                });
                self::applySwitcherBranchFilter($q, $user, $branchFilter);
                return;
            }

            // Sub-branch member: globals + client-level + main-branch + own.
            $branchId = $user->branch_id;
            $mainBranchId = Branch::where('client_id', $clientId)
                ->where('is_main', true)
                ->value('id');

            $q->where(function ($w) use ($clientId, $branchId, $mainBranchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId, $mainBranchId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId, $mainBranchId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                             if ($mainBranchId) {
                                 $wb->orWhere('branch_id', $mainBranchId);
                             }
                         });
                  });
            });
            // Sub-branch users can't use the switcher — branchFilter ignored.
            return;
        }

        // Unknown user_type → see nothing.
        $q->whereRaw('1 = 0');
    }

    /**
     * Returns a human-readable denial message, or null when the action is
     * allowed. Use in update() / destroy() to block descendants from
     * modifying ancestor-created rows even when they can see them.
     */
    public static function hierarchicalDenial(?User $user, $row, string $action): ?string
    {
        if (!$user || $user->user_type === 'super_admin') return null;
        if (!isset($row->created_by) || !$row->created_by) return null;
        if ((int) $row->created_by === (int) $user->id) return null;

        $creator = User::find($row->created_by);
        if (!$creator) return null;

        $userTier    = self::tierFor($user);
        $creatorTier = self::tierFor($creator, $row->branch_id ?? null);

        if ($creatorTier <= $userTier) return null;

        $byWhom = match ($creator->user_type) {
            'super_admin'             => 'a Super Admin',
            'client_admin'            => 'a Client Admin',
            'client_user'             => 'a Client user',
            'branch_user', 'employee' => $creatorTier === self::TIER_MAIN
                ? 'the Main Branch'
                : 'another Branch',
            default                   => 'a higher-privileged user',
        };
        $verb = $action === 'delete' ? 'delete' : 'edit';
        return "You cannot {$verb} this record — it was created by {$byWhom}.";
    }

    /** Narrow an already-scoped query when BranchSwitcher injects ?branch_id=N.
     *  Cross-tenant ids are silently dropped. */
    private static function applySwitcherBranchFilter(Builder $q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }

    /**
     * Tier of a user. `$fallbackBranchId` lets the caller pass a row's
     * branch_id so a creator whose own branch_id has since been cleared
     * is still ranked at the level the row was stamped at.
     */
    private static function tierFor(?User $u, $fallbackBranchId = null): int
    {
        if (!$u) return self::TIER_NONE;
        return match ($u->user_type) {
            'super_admin'                  => self::TIER_SUPER,
            'client_admin', 'client_user'  => self::TIER_CLIENT,
            'branch_user', 'employee'      => self::isMainBranchUser($u, $fallbackBranchId)
                ? self::TIER_MAIN
                : self::TIER_SUB,
            default                        => self::TIER_NONE,
        };
    }

    private static function isMainBranchUser(User $u, $fallbackBranchId): bool
    {
        $branchId = $u->branch_id ?: $fallbackBranchId;
        if (!$branchId) return false;
        return (bool) Branch::where('id', $branchId)->value('is_main');
    }
}
