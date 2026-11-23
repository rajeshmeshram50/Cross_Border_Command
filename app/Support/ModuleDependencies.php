<?php

namespace App\Support;

class ModuleDependencies
{
    public const MAP = [
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

        'hr.broadcast' => [
            'hr.employee', 'hr.onboarding',
        ],
        'hr.doc_templates' => [
            'hr.employee', 'hr.custom_fields', 'master.trigger_point',
        ],
    ];

    public static function directFor(string $slug): array
    {
        return self::MAP[$slug] ?? [];
    }

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
