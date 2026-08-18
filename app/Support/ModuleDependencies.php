<?php

namespace App\Support;

/**
 * HRMS module dependency matrix.
 *
 * A module can't function on its own: HR Employee needs the Department /
 * Designation / Role masters to render its dropdowns, Payroll needs Attendance
 * and Leave to compute a payslip, and so on. Granting only the "headline"
 * module and none of its feeders produced half-broken screens (empty selects,
 * 403s on the lookup calls), which is what this map fixes.
 *
 * Rule: granting ANY flag on a module implies can_view on every module it
 * depends on (transitively). Dependencies never inherit action flags — read
 * access is all a feeder screen needs.
 *
 * Keyed by module slug (see database/seeders/ModuleSeeder.php). Mirrored on the
 * frontend in resources/js/utils/moduleDependencies.ts — keep the two in sync.
 */
class ModuleDependencies
{
    /**
     * slug => list of slugs it depends on.
     *
     * Notes on a few entries:
     *  - "Biometric Device" has no module of its own; it rides on hr.attendance
     *    (see resources/js/utils/routeAccess.ts), so it needs no separate row.
     *  - Holiday (hr.holiday) is intentionally dependency-free — it is a
     *    standalone calendar master.
     */
    public const MAP = [
        // ── HR core ────────────────────────────────────────────────────────
        'hr.recruitment' => [
            'hr.employee', 'hr.onboarding', 'hr.exit',
            'master.departments', 'master.designations', 'master.roles',
        ],
        'hr.employee' => [
            'permissions', 'hr.onboarding', 'hr.leave', 'hr.holiday',
            'master.countries', 'master.departments', 'master.designations', 'master.roles',
            'master.leave_plan', 'master.leave_type',
            'master.assets', 'master.asset_categories', 'master.overtime_rates',
        ],
        'hr.onboarding' => [
            'hr.employee', 'hr.doc_templates', 'hr.leave', 'hr.holiday',
            'master.countries', 'master.departments', 'master.designations', 'master.roles',
            'master.leave_type', 'master.leave_plan',
            'master.assets', 'master.asset_categories', 'master.overtime_rates',
        ],
        'hr.exit' => [
            'hr.employee', 'hr.onboarding', 'hr.payroll', 'hr.doc_templates',
            'hr.attendance', 'hr.expense',
            'master.countries', 'master.departments', 'master.designations', 'master.roles',
            'master.leave_type', 'master.leave_plan', 'master.overtime_rates',
        ],

        // ── Time & pay ─────────────────────────────────────────────────────
        'hr.payroll' => [
            'hr.employee', 'hr.onboarding', 'hr.attendance', 'hr.leave', 'hr.holiday',
            'master.overtime_rates',
        ],
        'hr.attendance' => [
            'hr.employee', 'hr.onboarding', 'hr.leave', 'hr.holiday',
            'master.overtime_rates', 'master.leave_type', 'master.leave_plan',
        ],
        'hr.leave' => [
            'hr.employee', 'hr.onboarding', 'hr.holiday',
            'master.leave_plan', 'master.leave_type',
        ],
        'hr.holiday' => [],
        'hr.expense' => [
            'hr.employee', 'hr.onboarding',
            'master.expense_category',
        ],

        // ── Documents & comms ──────────────────────────────────────────────
        'hr.broadcast' => [
            'hr.employee', 'hr.onboarding',
        ],
        'hr.doc_templates' => [
            'hr.employee', 'hr.custom_fields', 'master.trigger_point',
        ],
    ];

    /**
     * Direct dependencies of one slug.
     *
     * @return string[]
     */
    public static function directFor(string $slug): array
    {
        return self::MAP[$slug] ?? [];
    }

    /**
     * Transitive closure of the dependencies of the given slugs.
     *
     * The seed slugs themselves are NOT included in the result — only the
     * modules they pull in. Cycles (Employee ↔ Onboarding, Leave → Employee →
     * Leave) are safe: the visited set stops the walk.
     *
     * @param  iterable<string>  $slugs
     * @return string[]
     */
    public static function resolve(iterable $slugs): array
    {
        $seeds = [];
        foreach ($slugs as $slug) {
            $seeds[$slug] = true;
        }

        $required = [];
        $stack = array_keys($seeds);

        while ($stack !== []) {
            $current = array_pop($stack);
            foreach (self::directFor($current) as $dep) {
                if (isset($required[$dep])) continue;
                $required[$dep] = true;
                $stack[] = $dep;
            }
        }

        // A seed is not "required by" itself — drop seeds so callers only see
        // what the grant added on top of what the operator explicitly ticked.
        foreach (array_keys($seeds) as $seed) {
            unset($required[$seed]);
        }

        return array_keys($required);
    }
}
