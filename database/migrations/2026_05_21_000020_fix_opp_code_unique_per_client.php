<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `leads.opp_code` was unique globally in the initial migration, which
 * would force tenants to share a single OPP-#### number-space. Switch to
 * per-tenant uniqueness so each client gets its own OPP-0001 series.
 *
 * Drops the standalone unique index and replaces it with a composite
 * (client_id, opp_code) unique constraint.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique(['opp_code']);
            $table->unique(['client_id', 'opp_code'], 'leads_client_opp_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropUnique('leads_client_opp_code_unique');
            $table->unique('opp_code');
        });
    }
};
