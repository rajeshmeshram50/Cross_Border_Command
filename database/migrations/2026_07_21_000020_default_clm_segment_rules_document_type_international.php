<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Default segment-rule document_type to INTERNATIONAL.
 *
 * Supersedes the "leave legacy rules untyped (null)" behaviour: every segment
 * rule is now International unless explicitly set to Domestic. Backfills the
 * pre-split (null) rows to 'international' and makes the column NOT NULL with a
 * DEFAULT of 'international' so any future insert that omits it lands on the
 * expected value.
 */
return new class extends Migration {
    public function up(): void
    {
        // Backfill legacy rows before tightening the column to NOT NULL.
        DB::table('clm_segment_rules')
            ->whereNull('document_type')
            ->update(['document_type' => 'international']);

        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->string('document_type', 16)->nullable(false)->default('international')->change();
        });
    }

    public function down(): void
    {
        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->string('document_type', 16)->nullable()->default(null)->change();
        });
    }
};
