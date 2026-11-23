<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('clm_segments')
            ->whereRaw("code ~ '^S-[0-9]+$'")
            ->update(['code' => DB::raw("regexp_replace(code, '^S-', 'SG-')")]);

        DB::table('clm_segment_rules')
            ->whereRaw("segment_code ~ '^S-[0-9]+$'")
            ->update(['segment_code' => DB::raw("regexp_replace(segment_code, '^S-', 'SG-')")]);
    }

    public function down(): void
    {
        DB::table('clm_segments')
            ->whereRaw("code ~ '^SG-[0-9]+$'")
            ->update(['code' => DB::raw("regexp_replace(code, '^SG-', 'S-')")]);

        DB::table('clm_segment_rules')
            ->whereRaw("segment_code ~ '^SG-[0-9]+$'")
            ->update(['segment_code' => DB::raw("regexp_replace(segment_code, '^SG-', 'S-')")]);
    }
};
