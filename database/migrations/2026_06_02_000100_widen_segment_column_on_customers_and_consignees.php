<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customers + Consignees now allow multi-select on the Segment field
 * (Dairy products, Fruits, Electronic, Vaccines, …). The frontend joins
 * the selection with ", " before POST, so picking 8–12 segments quickly
 * overflows the original varchar(64) cap and triggers a 422 with
 * "The segment field must not be greater than 64 characters."
 *
 * Mirror the fix already applied to clm_agreement_library.segment
 * (see 2026_05_30_000600_widen_segment_column_on_clm_agreement_library):
 * widen to 1024 chars on both tables. Validation rules in
 * CustomerController + ConsigneeController are updated in lockstep.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('segment', 1024)->nullable()->change();
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->string('segment', 1024)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('segment', 64)->nullable()->change();
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->string('segment', 64)->nullable()->change();
        });
    }
};
