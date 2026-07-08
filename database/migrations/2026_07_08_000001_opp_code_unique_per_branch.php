<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * OPP IDs are now sequenced PER BRANCH (each branch restarts at OPP-0001),
 * matching the per-branch Shipment ID sequence. That means two branches of
 * the same client can legitimately both hold OPP-0001, so the old
 * per-client UNIQUE (client_id, opp_code) would wrongly reject the second
 * branch's first lead.
 *
 * Replace it with a per-(client, branch) composite unique. Existing rows are
 * already unique per client, hence trivially unique per (client, branch),
 * so this widens — never violates — the constraint. Note: Postgres treats
 * NULL branch_id rows as mutually distinct, so client-level (null-branch)
 * leads are not de-duplicated by this index; their sequence is allocated
 * with whereNull('branch_id') in the app layer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique('leads_client_opp_code_unique');
            $table->unique(['client_id', 'branch_id', 'opp_code'], 'leads_client_branch_opp_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique('leads_client_branch_opp_code_unique');
            $table->unique(['client_id', 'opp_code'], 'leads_client_opp_code_unique');
        });
    }
};
