<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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
    }
};
