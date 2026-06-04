<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill: action permissions imply visibility.
 *
 * Historically can_view / can_add / can_edit / can_delete / can_export /
 * can_import / can_approve were stored as fully independent booleans, so a
 * user could end up with (e.g.) can_edit = true while can_view = false. Every
 * surface that gates a module — the sidebar menu, the page-access guards, and
 * the controller index() checks — keys off can_view, so those rows hid the
 * module entirely and locked the user out of the page they had edit rights on.
 *
 * From now on PermissionController::savePermissions forces can_view = true
 * whenever any other action flag is set. This one-time pass repairs every row
 * that predates that rule so existing grants surface correctly on next login.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('permissions')
            ->where('can_view', false)
            ->where(function ($q) {
                $q->where('can_add', true)
                    ->orWhere('can_edit', true)
                    ->orWhere('can_delete', true)
                    ->orWhere('can_export', true)
                    ->orWhere('can_import', true)
                    ->orWhere('can_approve', true);
            })
            ->update(['can_view' => true, 'updated_at' => now()]);
    }

    public function down(): void
    {
        // No-op: once an implied view is merged in we can't tell it apart from a
        // view that was granted explicitly, so reversing would corrupt grants.
    }
};
