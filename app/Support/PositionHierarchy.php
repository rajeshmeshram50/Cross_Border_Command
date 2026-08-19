<?php

namespace App\Support;

/**
 * Reporting-manager position hierarchy.
 *
 * Highest → lowest:  Branch User → HOD → Team Leader → Executive → Employee →
 * Intern/Trainee. An employee may only report to someone STRICTLY higher.
 *
 * Notes on the data model:
 *  - "Branch User" (and any tenant login user — client_admin / client_user) is
 *    a `users.user_type`, NOT a designation. It sits at the TOP of the employee
 *    org chart (Director / CEO), so it is eligible as a manager for everyone.
 *  - "Executive Employee" in the requirement is stored simply as "Executive" in
 *    the designations master (see MasterDataSeeder). Ranks are keyed on the
 *    exact stored designation name.
 *
 * Lower number = higher in the hierarchy. Eligible = manager rank < hire rank.
 */
class PositionHierarchy
{
    /** Login users (branch_user / client_admin / client_user) sit above all designations. */
    public const TOP_RANK = 1;

    /** Exact stored designation name → rank. */
    public const DESIGNATION_RANK = [
        'Head of Department (HOD)' => 2,
        'Team Leader'              => 3,
        'Executive'                => 4,
        'Employee'                 => 5,
        'Intern / Trainee'         => 6,
    ];

    /**
     * Bottom of the chart — held by someone with NO designation at all.
     *
     * Deliberately a real rank rather than null: null means "unknown", and the
     * leniency below then let such a person manage anyone, up to and including
     * an HOD. Having no position is not an unrecognised position; it is no
     * position, and it cannot sit above one.
     */
    public const UNRANKED = 99;

    public static function rankForDesignationName(?string $name): ?int
    {
        // No designation on the record → the bottom of the chart, never above
        // anybody. An unrecognised custom TITLE still returns null and keeps
        // the lenient path, so a tenant's own job titles never block a save.
        if ($name === null || trim($name) === '') return self::UNRANKED;
        return self::DESIGNATION_RANK[trim($name)] ?? null;
    }

    /** A login-user manager (Branch User etc.) is the top of the chart. */
    public static function rankForUserType(?string $userType): ?int
    {
        return in_array($userType, ['branch_user', 'client_admin', 'client_user', 'super_admin'], true)
            ? self::TOP_RANK
            : null;
    }

    /**
     * A manager is eligible only when STRICTLY higher (lower rank number). When
     * either rank is unknown (a custom/legacy designation not in the map) we stay
     * lenient and allow it — the map covers the seeded designations, and we never
     * want to block a valid save over an unrecognised title.
     *
     * Note that "no designation" is NOT unknown: it resolves to UNRANKED above,
     * a real number that loses every comparison, so someone without a position
     * is never eligible to manage someone who has one.
     */
    public static function eligible(?int $hireRank, ?int $managerRank): bool
    {
        if ($hireRank === null || $managerRank === null) return true;
        return $managerRank < $hireRank;
    }
}
