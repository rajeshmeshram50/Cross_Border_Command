<?php

namespace App\Support;

use App\Models\Module;
use App\Models\Permission;
use App\Models\User;

/**
 * Write access to the branch-SHARED CLM masters — Segment, Authority, Quality &
 * Compliance Docs, KYC, Due Diligence, Trade Licenses.
 *
 * WHY THIS EXISTS
 * ---------------
 * MasterVisibility already answers "may this user change this row?", and for
 * these six tables its answer was too narrow. Its own docblock concedes the
 * asymmetry: master data is branch-SHARED for reading — the whole branch works
 * off one lookup set — but "mutation is still peer-locked" to whoever created
 * the row.
 *
 * That produced a lock nobody had asked for. A segment is shared reference
 * data; the person who happens to have typed it in is not its owner in any
 * meaningful sense. Two consequences followed:
 *
 *   - Colleagues who share the segment could not correct it, including the
 *     creator's own manager.
 *   - When the creator left the company, the row became permanently
 *     uneditable by everyone except a super admin.
 *
 * And the lock was not the thing keeping the data safe. The real protection is
 * per-FIELD and usage-based, and it lives in the controllers: a segment's name
 * and regulatory status freeze the moment anything references them, because
 * renaming or re-classifying would break Vendors, Products, Customers and the
 * DCP rules built against them. Those guards apply to every user at every
 * level, and they still do — nothing here touches them. What the creator lock
 * blocked was the remainder, the edits already judged safe. Customer ≠
 * Consignee is deliberately left editable on an in-use segment, and its call
 * site says so, yet the row lock refused the request before that logic ran.
 *
 * So access is decided by the two things that actually describe the situation:
 * whether the data is shared with the user (their branch scope, already applied
 * by the query that fetched the row) and whether they were granted the
 * permission for it.
 *
 * STRICTLY ADDITIVE — this is the part to preserve if anyone edits this class.
 * The old rule is consulted FIRST and its "yes" is final. The permission can
 * only ever open a door, never close one. That matters because permission rows
 * are not uniformly populated: some branch admins hold no CLM grants at all yet
 * legitimately manage these masters today through the tier ladder. Gating on
 * the permission alone would have quietly locked them out of screens they have
 * always used.
 */
class ClmMasterAccess
{
    /**
     * Null when the action is allowed, otherwise a human-readable denial.
     *
     * @param string $action      'edit' | 'delete'
     * @param string $moduleSlug  e.g. 'clm.segment'
     */
    public static function denial(?User $user, $row, string $action, string $moduleSlug): ?string
    {
        // Whatever the creator-hierarchy rule already permits stays permitted.
        $legacy = MasterVisibility::hierarchicalDenial($user, $row, $action);
        if ($legacy === null) {
            return null;
        }

        // Refused there — the module grant is the second way in.
        if (self::hasGrant($user, $moduleSlug, $action)) {
            return null;
        }

        $verb = $action === 'delete' ? 'delete' : 'edit';
        $label = self::moduleName($moduleSlug);

        return "You do not have permission to {$verb} {$label} records. "
             . 'Ask an administrator to grant it under Permissions.';
    }

    /** True when the user holds can_edit / can_delete on the module. */
    private static function hasGrant(?User $user, string $moduleSlug, string $action): bool
    {
        if (!$user) return false;

        $column = $action === 'delete' ? 'can_delete' : 'can_edit';

        $moduleId = self::moduleId($moduleSlug);
        // No module row means the permission cannot be granted OR checked. Deny
        // rather than guess — the legacy rule above has already had its say, so
        // this only ever declines to ADD access.
        if (!$moduleId) return false;

        return Permission::query()
            ->where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where($column, true)
            ->exists();
    }

    /** Per-request memo — these run on every write across six controllers. */
    private static array $moduleCache = [];

    private static function moduleId(string $slug): ?int
    {
        if (!array_key_exists($slug, self::$moduleCache)) {
            self::$moduleCache[$slug] = Module::where('slug', $slug)->value('id');
        }
        return self::$moduleCache[$slug] ? (int) self::$moduleCache[$slug] : null;
    }

    private static function moduleName(string $slug): string
    {
        return (string) (Module::where('slug', $slug)->value('name') ?: 'these');
    }
}
