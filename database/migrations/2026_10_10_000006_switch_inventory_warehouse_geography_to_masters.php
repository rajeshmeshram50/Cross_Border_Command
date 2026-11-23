<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_warehouses', function (Blueprint $t) {
            $t->unsignedBigInteger('country_id')->nullable()->after('address')->index();
            $t->unsignedBigInteger('state_id')->nullable()->after('country_id')->index();
            $t->string('state_name', 100)->nullable()->after('state_id');
        });

        $states = [];
        foreach (DB::table('master_states')->get(['id', 'name', 'country_id']) as $s) {
            $states[mb_strtolower(trim((string) $s->name))] = $s;
        }
        $countries = [];
        foreach (DB::table('master_countries')->get(['id', 'name']) as $c) {
            $countries[mb_strtolower(trim((string) $c->name))] = $c->id;
        }

        foreach (DB::table('inventory_warehouses')->get(['id', 'country', 'state']) as $row) {
            $stateKey   = mb_strtolower(trim((string) $row->state));
            $countryKey = mb_strtolower(trim((string) $row->country));
            $state      = $states[$stateKey] ?? null;

            DB::table('inventory_warehouses')->where('id', $row->id)->update([
                'country_id' => $countries[$countryKey] ?? ($state->country_id ?? null),
                'state_id'   => $state->id ?? null,
                'state_name' => $state ? null : ($row->state ?: null),
            ]);
        }

        Schema::table('inventory_warehouses', function (Blueprint $t) {
            $t->dropColumn(['country', 'state']);
        });
    }

    public function down(): void
    {
        Schema::table('inventory_warehouses', function (Blueprint $t) {
            $t->string('country', 100)->nullable()->after('address');
            $t->string('state', 100)->nullable()->after('country');
        });

        foreach (DB::table('inventory_warehouses')->get(['id', 'country_id', 'state_id', 'state_name']) as $row) {
            DB::table('inventory_warehouses')->where('id', $row->id)->update([
                'country' => $row->country_id
                    ? DB::table('master_countries')->where('id', $row->country_id)->value('name')
                    : null,
                'state' => $row->state_id
                    ? DB::table('master_states')->where('id', $row->state_id)->value('name')
                    : $row->state_name,
            ]);
        }

        Schema::table('inventory_warehouses', function (Blueprint $t) {
            $t->dropIndex(['country_id']);
            $t->dropIndex(['state_id']);
            $t->dropColumn(['country_id', 'state_id', 'state_name']);
        });
    }
};
