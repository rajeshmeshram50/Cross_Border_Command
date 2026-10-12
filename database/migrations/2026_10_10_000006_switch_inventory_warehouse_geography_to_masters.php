<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Warehouse geography moves onto the masters.
 *
 * inventory_warehouses shipped with country / state as free text, which is the
 * same mistake master_warehouse_master made — 2026_08_04_190000 had to undo it
 * there, for the reason given in its own docblock: nothing could offer a State
 * list filtered by Country, and any string at all could be saved.
 *
 * state_name survives alongside state_id because the form offers the States
 * master only for India; every other country takes a typed province that no id
 * can hold. Exactly one of the two is ever filled.
 *
 * The backfill matches on name, case-insensitively, exactly as the 08_04 one
 * did. A row whose text matches no master keeps its text in state_name, so
 * nothing is lost either way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_warehouses', function (Blueprint $t) {
            $t->unsignedBigInteger('country_id')->nullable()->after('address')->index();
            $t->unsignedBigInteger('state_id')->nullable()->after('country_id')->index();
            $t->string('state_name', 100)->nullable()->after('state_id');
        });

        // The masters are small, so they are read once and indexed by name
        // rather than queried per warehouse.
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
                // Unmatched text is kept, not thrown away.
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
