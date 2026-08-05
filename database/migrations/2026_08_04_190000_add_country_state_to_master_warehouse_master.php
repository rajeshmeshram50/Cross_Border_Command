<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Warehouse Master: Country + State become master references.
 *
 * The table had NO country column at all, and `state` was free text — so a
 * warehouse could be saved with any string in it, and the form had no way to
 * offer a State list filtered by Country. Adding country_id / state_id lets the
 * master form use the standard ref + cascadeFrom dropdowns.
 *
 * The legacy `state` varchar is deliberately KEPT: dropping it would throw away
 * the only copy of the value for any row whose text doesn't match a master
 * State, and other readers may still reference it. It simply stops being the
 * field the form writes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_warehouse_master', function (Blueprint $table) {
            $table->unsignedBigInteger('country_id')->nullable()->after('wh_type');
            $table->unsignedBigInteger('state_id')->nullable()->after('country_id');
        });

        /* Backfill from the legacy free-text state. Matched case-insensitively
         * on the state NAME — the states master is loaded once and indexed, so
         * this stays one query regardless of how many warehouses exist.
         * A row whose text matches nothing keeps NULL and is corrected the next
         * time someone edits it; nothing is lost, because `state` is retained. */
        $byName = [];
        foreach (DB::table('master_states')->get(['id', 'name', 'country_id']) as $s) {
            $byName[mb_strtolower(trim((string) $s->name))] = $s;
        }

        foreach (DB::table('master_warehouse_master')->get(['id', 'state']) as $row) {
            $key = mb_strtolower(trim((string) $row->state));
            if ($key === '' || !isset($byName[$key])) continue;
            DB::table('master_warehouse_master')->where('id', $row->id)->update([
                'state_id'   => $byName[$key]->id,
                'country_id' => $byName[$key]->country_id,
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('master_warehouse_master', function (Blueprint $table) {
            $table->dropColumn(['country_id', 'state_id']);
        });
    }
};
