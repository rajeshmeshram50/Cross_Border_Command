<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('master_warehouse_master', function (Blueprint $table) {
            $table->unsignedBigInteger('country_id')->nullable()->after('wh_type');
            $table->unsignedBigInteger('state_id')->nullable()->after('country_id');
        });

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
