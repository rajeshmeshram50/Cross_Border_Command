<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-branch customer / consignee code sequences.
 *
 * Previously the code was unique per CLIENT (C-001, C-002 … shared across every
 * branch of the client), so Branch 2's first customer continued the client-wide
 * counter (e.g. C-002) instead of starting its own sequence. Each branch should
 * own its numbering (Branch 1 → C-001…, Branch 2 → C-001…), so the uniqueness
 * key moves from (client_id, code) to (client_id, branch_id, code).
 *
 * COALESCE(branch_id, 0) is used so rows with a NULL branch (client-admin, no
 * branch) still share one bucket and stay unique among themselves — a plain
 * NULL column in a unique index treats every NULL as distinct and would let
 * duplicates through.
 */
return new class extends Migration
{
    public function up(): void
    {
        // customers
        DB::statement('DROP INDEX IF EXISTS customers_client_customer_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX customers_client_branch_customer_code_unique '
            . 'ON customers (client_id, COALESCE(branch_id, 0), customer_code) '
            . 'WHERE deleted_at IS NULL'
        );

        // consignees
        DB::statement('DROP INDEX IF EXISTS consignees_client_consignee_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX consignees_client_branch_consignee_code_unique '
            . 'ON consignees (client_id, COALESCE(branch_id, 0), consignee_code) '
            . 'WHERE deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS customers_client_branch_customer_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX customers_client_customer_code_unique '
            . 'ON customers (client_id, customer_code) WHERE deleted_at IS NULL'
        );

        DB::statement('DROP INDEX IF EXISTS consignees_client_branch_consignee_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX consignees_client_consignee_code_unique '
            . 'ON consignees (client_id, consignee_code) WHERE deleted_at IS NULL'
        );
    }
};
