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
 * Rule: granting ANY flag on a module implies can_view on the modules listed
 * against it in the matrix — that row only, never the dependencies of those
 * dependencies. Dependencies don't inherit action flags either; read access is
 * all a feeder screen needs.
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
        // Biometric Device has no module row of its own — it rides on
        // hr.attendance, which is already listed here.
        //
        // hr.exit is DELIBERATELY here even though the printed HRMS matrix
        // sheet omits it from the Payroll row: full-and-final settlement is
        // driven off the exit record, so Payroll without Exit shows an empty
        // FnF screen. Confirmed by the product owner 2026-08-19 — the sheet is
        // the stale side. Don't "correct" this back without re-checking there.
        'hr.payroll' => [
            'hr.employee', 'hr.onboarding', 'hr.exit', 'hr.attendance', 'hr.leave', 'hr.holiday',
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
     * The dependencies of the given slugs — ONE HOP ONLY, exactly the row of
     * the matrix and nothing beyond it.
     *
     * Deliberately NOT transitive. Following the chain (Broadcast → Employee →
     * Onboarding → Document Template → Custom Field …) is defensible on paper,
     * but in practice almost every HR grant dragged in the whole HR tree plus a
     * dozen masters, which is not what the matrix says and not what an admin
     * ticking one box expects to hand out. What the sheet lists for a module is
     * what that module gets.
     *
     * The seed slugs themselves are never returned — a module is not its own
     * dependency, so callers only see what the grant added on top of what the
     * operator explicitly ticked.
     *
     * IMPORTANT: pass ONLY the modules the operator explicitly ticked. Feeding
     * the auto-granted rows back in makes the walk transitive by the back door
     * — Recruitment → Employee → countries / leave / holiday, → Exit → Payroll
     * / Attendance / Expense → overtime + expense masters — which is precisely
     * what this matrix rules out. Callers tell the two apart via the `is_auto`
     * column on permissions / department_permissions.
     *
     * @param  iterable<string>  $slugs  explicitly granted module slugs
     * @return string[]
     */
    public static function resolve(iterable $slugs): array
    {
        $seeds = [];
        foreach ($slugs as $slug) {
            $seeds[$slug] = true;
        }

        $required = [];
        foreach (array_keys($seeds) as $seed) {
            foreach (self::directFor($seed) as $dep) {
                if (isset($seeds[$dep])) continue;
                $required[$dep] = true;
            }
        }

        return array_keys($required);
    }
}
