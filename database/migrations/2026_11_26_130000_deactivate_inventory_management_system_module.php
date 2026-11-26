<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Hide "Inventory Management System" from the Manage Permission tree by marking
// the top-level 'inventory' module inactive (PermissionController::modules()
// returns only is_active=true). Reversible; the row and any grants are kept.
return new class extends Migration
{
    public function up(): void
    {
        DB::table('modules')->where('slug', 'inventory')->update(['is_active' => false]);
    }

    public function down(): void
    {
        DB::table('modules')->where('slug', 'inventory')->update(['is_active' => true]);
    }
};
