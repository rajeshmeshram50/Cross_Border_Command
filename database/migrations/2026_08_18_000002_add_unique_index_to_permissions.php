<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One permission row per (user, module).
 *
 * The table has always been written as delete-then-insert, so nothing produced
 * duplicates in practice — but the schema never said so. A second row for the
 * same module is silently contradictory (which flags win?), and every reader
 * assumes at most one, so the invariant belongs in the database rather than in
 * the discipline of every future writer.
 *
 * Same for department_permissions, which is written with updateOrCreate on
 * exactly this key triple.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Collapse any duplicates first (keep the newest row per pair) — the
        // index cannot be created while they exist.
        $dupes = DB::table('permissions')
            ->select('user_id', 'module_id', DB::raw('MAX(id) as keep_id'))
            ->groupBy('user_id', 'module_id')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($dupes as $d) {
            DB::table('permissions')
                ->where('user_id', $d->user_id)
                ->where('module_id', $d->module_id)
                ->where('id', '!=', $d->keep_id)
                ->delete();
        }

        Schema::table('permissions', function (Blueprint $table) {
            $table->unique(['user_id', 'module_id'], 'permissions_user_module_unique');
        });

        if (Schema::hasTable('department_permissions')) {
            $deptDupes = DB::table('department_permissions')
                ->select('client_id', 'department_id', 'module_id', DB::raw('MAX(id) as keep_id'))
                ->groupBy('client_id', 'department_id', 'module_id')
                ->havingRaw('COUNT(*) > 1')
                ->get();

            foreach ($deptDupes as $d) {
                DB::table('department_permissions')
                    ->where('client_id', $d->client_id)
                    ->where('department_id', $d->department_id)
                    ->where('module_id', $d->module_id)
                    ->where('id', '!=', $d->keep_id)
                    ->delete();
            }

            Schema::table('department_permissions', function (Blueprint $table) {
                $table->unique(['client_id', 'department_id', 'module_id'], 'dept_permissions_unique');
            });
        }
    }

    public function down(): void
    {
        Schema::table('permissions', function (Blueprint $table) {
            $table->dropUnique('permissions_user_module_unique');
        });

        if (Schema::hasTable('department_permissions')) {
            Schema::table('department_permissions', function (Blueprint $table) {
                $table->dropUnique('dept_permissions_unique');
            });
        }
    }
};
