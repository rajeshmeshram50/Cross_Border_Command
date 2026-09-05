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
 *     └── Branches (all equal peers — no privileged "main" branch)
 *            ├── Branch branch_user (branch admin — scoped to own branch)
 *            └── Branch employees    (private — peer-isolated)
 *
 * Key idea: rows are visible based on *who created them*, not just where
 * the row is stamped.
 *
 * READ visibility — every row is visible to:
 *   - super_admin                         : all rows
 *   - client_admin / client_user          : their client's rows + globals
 *                                           (may narrow via BranchSwitcher)
 *   - branch_user                         : globals + client-level rows
 *                                           + own branch rows. Other
 *                                             branches stay hidden — every
 *                                             branch is an isolated peer.
 *   - employee                            : globals + client-level rows
 *                                           + ONLY OWN rows (created_by = self)
 *                                           — peer employees in the same
 *                                           branch are HIDDEN from each
 *                                           other. EXCEPT master data
 *                                           (`master_*` / `clm_*` tables),
 *                                           which is branch-SHARED: the whole
 *                                           branch reads one lookup set, same
 *                                           as the branch admin. Mutation is
 *                                           still peer-locked.
 *
 * MUTATE (edit/delete) — only the creator + ancestor tiers can modify:
 *   - super_admin                         : any row
 *   - own row (created_by == auth)        : always allowed
 *   - employee viewer                     : ONLY own rows (peer-isolated)
 *   - else: viewer's tier must be >= the row's tier on the ladder
 *           super_admin > client > branch
 */
class MasterVisibility
{
    private const TIER_SUPER  = 5;
    private const TIER_CLIENT = 4;
    private const TIER_BRANCH = 2;
    private const TIER_NONE   = 0;

    /**
     * Apply the standard creator-hierarchy READ scope to a query.
     *
     * `$branchFilter` is the BranchSwitcher's narrowing (only honoured for
     * roles that can switch — client_admin / client_user; silently ignored
     * for branch users and employees, who are locked to their own scope).
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

        // Employees are PEER-ISOLATED — they see only their own rows plus
        // ancestor-tier reference data (globals + client-level rows).
        if (($user->user_type ?? null) === 'employee') {
            // EXCEPTION — MASTER DATA is BRANCH-SHARED: every employee sees the
            // whole branch's rows (same view as the branch admin), not just
            // their own. Detected by the `master_` / `clm_` table prefixes so
            // all master tables opt in uniformly — the ~54 `master_*` lookups
            // (roles, departments, designations, leave types, warehouses, …)
            // and the CLM masters (kyc, dd, qc, segments, authorities,
            // trade-licenses, agreements/clauses/tnc/trade-doc libraries,
            // segment-rules).
            //
            // Peer-isolation is wrong for lookups: a role/department the BRANCH
            // ADMIN creates is stamped (client_id=own, branch_id=own) and so
            // fell through every arm of the employee rule below — invisible to
            // every employee under that branch. Employee-facing pickers
            // (Primary/Ancillary Role, Department, Designation, Recruitment's
            // Assigned HR …) then listed only the super-admin globals, and a
            // colleague already holding a branch-created role rendered blank
            // because the option could not be resolved.
            //
            // This only widens READ visibility — mutating another member's row
            // stays blocked by hierarchicalDenial() below.
            $table = $q->getModel()->getTable();
            if (str_starts_with($table, 'master_') || str_starts_with($table, 'clm_')) {
                self::applyBranchScope($q, $user);
                return;
            }

            $userId = (int) $user->id;

            $q->where(function ($w) use ($clientId, $userId) {
                $w->whereNull('client_id')                      // globals
                  ->orWhere(function ($ww) use ($clientId, $userId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($userId) {
                             $wb->whereNull('branch_id')        // client-level rows
                                ->orWhere('created_by', $userId); // own rows
                         });
                  });
            });
            // Employees can't use the BranchSwitcher.
            return;
        }

        if (($user->user_type ?? null) === 'branch_user') {
            // Branch admin: globals + client-level rows + own branch rows.
            // Every branch is an isolated peer — sibling branches stay hidden.
            // Branch users can't use the switcher — branchFilter ignored.
            self::applyBranchScope($q, $user);
            return;
        }

        // Unknown user_type → see nothing.
        $q->whereRaw('1 = 0');
    }

    /**
     * Branch-wide READ scope: globals + client-level rows + the user's OWN
     * branch rows (sibling branches stay hidden). This is the branch-admin
     * view, and is ALSO granted to Sales-department employees for the
     * Customer / Consignee books so the whole Sales team shares one branch
     * customer list instead of each employee seeing only their own rows
     * (QA #14). Ignores the BranchSwitcher — the user is locked to their own
     * branch.
     */
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

    /**
     * Returns a human-readable denial message, or null when the action is
     * allowed. Use in update() / destroy() to block descendants from
     * modifying ancestor-created rows even when they can see them.
     *
     * The row's tier is determined by its ownership stamp (`client_id` +
     * `branch_id`). Deriving the tier from the stamp — not the creator's
     * *current* user_type — is critical: without it, rows with a NULL or
     * stale `created_by` (seeded data, migrated rows, rows whose creator
     * was deleted) would silently fall through and become deletable by any
     * tier.
     */
    public static function hierarchicalDenial(?User $user, $row, string $action): ?string
    {
        if (!$user || $user->user_type === 'super_admin') return null;

        // Customers, Consignees & Suppliers are intentionally open: ANYONE in the tenant
        // (employees included) may edit/delete any customer/consignee/supplier — no
        // ownership/tier lock on these. (Tenant scoping still applies on the
        // query that fetched the row.) Segment-document protection is enforced
        // separately in the Customer/Consignee update path.
        //
        // Vendor is here because the module grant is the gate, not authorship.
        // Its read scope is ALREADY branch-shared (Vendor::scopeForUser puts
        // every employee on the whole branch’s supplier book), so locking
        // mutation to the creator produced the worst version of a permission:
        // a colleague could open a supplier, work through the wizard and only
        // be refused at Save. A supplier is shared reference data — whoever
        // holds the supplier permission maintains it.
        if ($row instanceof \App\Models\Customer
            || $row instanceof \App\Models\Consignee
            || $row instanceof \App\Models\Vendor) {
            return null;
        }

        // CLM MASTERS are open on the same terms: the CLM module grant is the
        // gate, not row ownership. A trade document, agreement, clause, T&C or
        // DCP rule is shared reference data for the whole tenant — the person
        // who first typed it in has no special claim on it, and locking it to
        // them meant an employee could open the Edit wizard, fill in Step 1 and
        // only be refused at Save (the row carries no can_edit flag, so the UI
        // had no way to disable the button up front).
        //
        // Listed one by one rather than matched on a "Clm" name prefix: this is
        // an authorisation boundary, so a new CLM model must be opened on
        // purpose, never by inheriting a pattern.
        //
        // NOT exempt, and must stay that way:
        //   • CtcContract         — case-to-case contracts are the record of one
        //                           deal, not shared master data.
        //   • ClmSignatureRequest — likewise per-transaction.
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

        // Always allow the row's own creator to manage it. (When
        // created_by is null, this short-circuit doesn't fire — we
        // fall through to the tier check below.)
        $isOwnRow = isset($row->created_by) && $row->created_by
            && (int) $row->created_by === (int) $user->id;
        if ($isOwnRow) return null;

        // Employees are peer-isolated — they can ONLY mutate rows they
        // created themselves. Even rows their own branch admin created
        // are off-limits. This short-circuits before the tier ladder so
        // an employee in the same branch as the row's creator still
        // gets denied.
        if (($user->user_type ?? null) === 'employee') {
            $verb = $action === 'delete' ? 'delete' : 'edit';
            return "You cannot {$verb} this record — employees can only manage rows they created themselves.";
        }

        $userTier = self::tierFor($user);

        // Row's tier is derived from its own ownership stamps
        // (client_id + branch_id), never from the creator's *current* state.
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

        // Resolve the creator just to refine the error message — the
        // tier decision above already stands on the row's stamps.
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

    /** Tier of a user on the ladder super_admin > client > branch. */
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
