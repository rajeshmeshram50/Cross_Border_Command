<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Agreement wizard now lets less-regulated agreements target
 * multiple segments at once (multi-select), persisted as a comma-
 * separated list in `clm_agreement_library.segment`. The previous
 * varchar(64) cap was sized for a single segment name and overflows
 * on the new multi-segment shape — widen to 1024 (still searchable
 * with the LIKE-based query in ClmAgreementController::applicableForLead).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            $table->string('segment', 1024)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('clm_agreement_library', function (Blueprint $table) {
            $table->string('segment', 64)->nullable()->change();
        });
    }
};
