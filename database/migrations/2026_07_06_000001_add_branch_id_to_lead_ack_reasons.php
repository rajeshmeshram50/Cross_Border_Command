<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Branch-isolate the Lead Acknowledgement reasons master.
 *
 * The table only carried client_id, so every branch of a client saw and edited
 * the SAME rows — data created in Branch 1 leaked into Branch 2, and toggling a
 * reason's status in one branch flipped it everywhere. Adding branch_id lets
 * each branch own its own set of reasons.
 *
 * Existing rows (branch_id NULL) are backfilled to each client's lowest branch
 * id so historical data stays visible in one branch instead of vanishing once
 * the list starts filtering by branch. Clients with no branch keep NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lead_ack_reasons', function (Blueprint $table) {
            $table->unsignedBigInteger('branch_id')->nullable()->after('client_id')->index();
        });

        DB::statement(
            'UPDATE lead_ack_reasons lar '
            . 'SET branch_id = (SELECT MIN(b.id) FROM branches b WHERE b.client_id = lar.client_id) '
            . 'WHERE lar.branch_id IS NULL'
        );
    }

    public function down(): void
    {
        Schema::table('lead_ack_reasons', function (Blueprint $table) {
            $table->dropColumn('branch_id');
        });
    }
};
