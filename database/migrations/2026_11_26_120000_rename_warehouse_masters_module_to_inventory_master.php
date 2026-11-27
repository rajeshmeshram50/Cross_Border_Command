<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Manage Permission heading: rename the master.warehouse category from
// "Warehouse Masters" to "Inventory Master" to match the rest of the app.
return new class extends Migration
{
    public function up(): void
    {
        DB::table('modules')
            ->where('slug', 'master.warehouse')
            ->where('name', 'Warehouse Masters')
            ->update(['name' => 'Inventory Master']);
    }

    public function down(): void
    {
        DB::table('modules')
            ->where('slug', 'master.warehouse')
            ->where('name', 'Inventory Master')
            ->update(['name' => 'Warehouse Masters']);
    }
};
