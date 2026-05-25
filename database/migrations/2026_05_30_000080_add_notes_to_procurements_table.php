<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add a free-text Notes / Remarks field to procurements.
 *
 * The Stage 3 "Create Product Sourcing" modal exposes this as a single
 * textarea below the basic-info row — captures whatever context the
 * salesperson wants to attach to the sourcing request (lead-time concerns,
 * vendor preferences, etc).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('procurements', function (Blueprint $table) {
            $table->text('notes')->nullable()->after('attachments');
        });
    }

    public function down(): void
    {
        Schema::table('procurements', function (Blueprint $table) {
            $table->dropColumn('notes');
        });
    }
};
