<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Re-prefix segment codes S-NNN -> SG-NNN.
 *
 * The code is stored in two coupled places and must move in lockstep:
 *   - clm_segments.code              (the source of truth shown in Segment Master)
 *   - clm_segment_rules.segment_code (a denormalised copy the DCP joins on)
 *
 * Only rows matching the old ^S-\d+$ shape are touched, so a re-run (or an env
 * already on SG-) is a no-op. Postgres regexp_replace keeps the numeric suffix.
 */
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
