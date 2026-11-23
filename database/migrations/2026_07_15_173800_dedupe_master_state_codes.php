<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('master_state_codes') || !Schema::hasTable('master_states')) return;

        $safeCodes = DB::table('master_state_codes as sc')
            ->join('master_states as s', DB::raw('s.id::text'), '=', DB::raw('sc.state_id::text'))
            ->distinct()
            ->pluck('sc.state_code');

        if ($safeCodes->isEmpty()) return;

        DB::table('master_state_codes')
            ->whereIn('state_code', $safeCodes)
            ->whereNotIn('id', function ($q) {
                $q->select('sc2.id')
                    ->from('master_state_codes as sc2')
                    ->join('master_states as s2', DB::raw('s2.id::text'), '=', DB::raw('sc2.state_id::text'));
            })
            ->delete();
    }

    public function down(): void
    {
    }
};
