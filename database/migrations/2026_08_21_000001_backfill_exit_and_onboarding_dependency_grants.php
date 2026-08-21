<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill the two HRMS dependency-matrix changes onto grants that were saved
 * before they existed. Without this, only permission rows re-saved from the
 * matrix screen would pick them up.
 *
 *  1. Exit Management now feeds off Custom Field + Trigger Point (its form
 *     renders the tenant's custom fields and its letters fire off the
 *     trigger-point master). Anyone holding Exit gets can_view on both.
 *
 *  2. Onboarding → Employee is now a write-capable dependency: the wizard saves
 *     THROUGH /employees/{id}, so a view-only feeder grant left the employee
 *     form inside onboarding frozen. Anyone holding Edit on Onboarding gets
 *     Edit on their auto-granted Employee row.
 *
 * Both run over `permissions` (per user) and `department_permissions`.
 * Explicit (non-auto) rows are never touched in (2) — an operator's own grant
 * outranks an implied one, exactly as PermissionController does it.
 */
return new class extends Migration
{
    /** [table => owner column] */
    private const TABLES = [
        'permissions' => 'user_id',
        'department_permissions' => 'department_id',
    ];

    private const EXIT_FEEDERS = ['hr.custom_fields', 'master.trigger_point'];

    private const FLAGS = [
        'can_view', 'can_add', 'can_edit', 'can_delete',
        'can_export', 'can_import', 'can_approve',
    ];

    public function up(): void
    {
        $moduleId = fn (string $slug) => DB::table('modules')->where('slug', $slug)->value('id');

        $exitId       = $moduleId('hr.exit');
        $onboardingId = $moduleId('hr.onboarding');
        $employeeId   = $moduleId('hr.employee');

        foreach (self::TABLES as $table => $ownerCol) {
            if (!DB::getSchemaBuilder()->hasTable($table)) continue;
            $hasIsAuto = DB::getSchemaBuilder()->hasColumn($table, 'is_auto');

            // ── 1. Exit → Custom Field + Trigger Point ─────────────────────
            if ($exitId) {
                foreach (self::EXIT_FEEDERS as $slug) {
                    $feederId = $moduleId($slug);
                    if (!$feederId) continue;

                    $holders = DB::table($table)
                        ->where('module_id', $exitId)
                        ->where(function ($q) {
                            foreach (self::FLAGS as $flag) $q->orWhere($flag, true);
                        })
                        ->get();

                    foreach ($holders as $holder) {
                        $owner = $holder->{$ownerCol};
                        $exists = DB::table($table)
                            ->where($ownerCol, $owner)
                            ->where('module_id', $feederId)
                            ->when($table === 'department_permissions',
                                fn ($q) => $q->where('client_id', $holder->client_id))
                            ->first();

                        if ($exists) {
                            // Leave any existing row alone beyond ensuring view:
                            // it may be the operator's own explicit grant.
                            if (!$exists->can_view) {
                                DB::table($table)->where('id', $exists->id)
                                    ->update(['can_view' => true, 'updated_at' => now()]);
                            }
                            continue;
                        }

                        $row = [
                            $ownerCol => $owner,
                            'module_id' => $feederId,
                            'can_view' => true,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ];
                        foreach (self::FLAGS as $flag) {
                            if ($flag !== 'can_view') $row[$flag] = false;
                        }
                        if ($hasIsAuto) $row['is_auto'] = true;
                        if ($table === 'department_permissions') $row['client_id'] = $holder->client_id;

                        DB::table($table)->insert($row);
                    }
                }
            }

            // ── 2. Onboarding(edit) → Employee(edit) on auto rows ──────────
            if ($onboardingId && $employeeId) {
                $editHolders = DB::table($table)
                    ->where('module_id', $onboardingId)
                    ->where('can_edit', true)
                    ->when($hasIsAuto, fn ($q) => $q->where('is_auto', false))
                    ->get();

                foreach ($editHolders as $holder) {
                    DB::table($table)
                        ->where($ownerCol, $holder->{$ownerCol})
                        ->where('module_id', $employeeId)
                        ->when($table === 'department_permissions',
                            fn ($q) => $q->where('client_id', $holder->client_id))
                        // Only the implied row. An explicit Employee grant is the
                        // operator's decision and stays as they left it.
                        ->when($hasIsAuto, fn ($q) => $q->where('is_auto', true))
                        ->update(['can_edit' => true, 'can_view' => true, 'updated_at' => now()]);
                }
            }
        }
    }

    /**
     * Not reversible: the auto-granted rows are indistinguishable from ones an
     * operator has since confirmed, and revoking access on a rollback is the
     * more damaging of the two mistakes.
     */
    public function down(): void
    {
    }
};
