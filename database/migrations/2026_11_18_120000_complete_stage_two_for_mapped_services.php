<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $mapped = fn ($q) => $q->select(DB::raw(1))->from('p2p_service_suppliers as m')
            ->whereColumn('m.service_id', 'p2p_services.id')->where('m.status', 'active');

        DB::table('p2p_services')->whereNull('deleted_at')->where('step_completed', '<', 2)
            ->whereExists($mapped)->update(['step_completed' => 2, 'updated_at' => now()]);

        DB::table('p2p_services')->whereNull('deleted_at')->where('status', 'draft')
            ->whereExists($mapped)->update(['status' => 'active', 'updated_at' => now()]);
    }

    public function down(): void
    {
    }
};
