<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Make customer / consignee display codes PER-CLIENT sequential.
 *
 * Before: customer_code (C-###) and consignee_code (CN-###) were derived
 * from the GLOBAL autoincrement id, which is shared across every tenant.
 * Because each client only sees its own rows, the numbers leaked the
 * cross-tenant sequence into each list — Client A would see C-009 → C-060
 * with large gaps where other clients' rows sat in between. It looked
 * broken even though the data itself was correctly tenant-isolated.
 *
 * This migration:
 *   1. Renumbers every existing row PER CLIENT in creation order, giving
 *      each tenant a clean C-001, C-002 … / CN-001, CN-002 … sequence.
 *      (NULL client_id — the super_admin global bucket — is renumbered as
 *      its own single partition.)
 *   2. Replaces the GLOBAL unique constraint on the code column with a
 *      per-tenant partial unique index (client_id, code) WHERE deleted_at
 *      IS NULL — otherwise two clients both reaching C-001 would collide
 *      on the old global index. The partial WHERE lets a soft-deleted row
 *      keep its historical code without blocking the live set.
 *
 * Allocation going forward is handled in CustomerController::nextCustomerCode
 * / ConsigneeController::nextConsigneeCode under a clients-row lock.
 *
 * Postgres-specific SQL (this project runs on PostgreSQL).
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Customers ──────────────────────────────────────────────────
        DB::statement('ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_code_unique');
        DB::statement(<<<'SQL'
            WITH ordered AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY id) AS rn
                FROM customers
            )
            UPDATE customers c
            SET customer_code = 'C-' || LPAD(o.rn::text, 3, '0')
            FROM ordered o
            WHERE c.id = o.id
        SQL);
        DB::statement(<<<'SQL'
            CREATE UNIQUE INDEX IF NOT EXISTS customers_client_customer_code_unique
            ON customers (client_id, customer_code) WHERE deleted_at IS NULL
        SQL);

        // ── Consignees ─────────────────────────────────────────────────
        DB::statement('ALTER TABLE consignees DROP CONSTRAINT IF EXISTS consignees_consignee_code_unique');
        DB::statement(<<<'SQL'
            WITH ordered AS (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY id) AS rn
                FROM consignees
            )
            UPDATE consignees c
            SET consignee_code = 'CN-' || LPAD(o.rn::text, 3, '0')
            FROM ordered o
            WHERE c.id = o.id
        SQL);
        DB::statement(<<<'SQL'
            CREATE UNIQUE INDEX IF NOT EXISTS consignees_client_consignee_code_unique
            ON consignees (client_id, consignee_code) WHERE deleted_at IS NULL
        SQL);
    }

    public function down(): void
    {
        // Reverse to the global id-based codes + global unique constraint.
        DB::statement('DROP INDEX IF EXISTS customers_client_customer_code_unique');
        DB::statement("UPDATE customers SET customer_code = 'C-' || LPAD(id::text, 3, '0')");
        DB::statement('ALTER TABLE customers ADD CONSTRAINT customers_customer_code_unique UNIQUE (customer_code)');

        DB::statement('DROP INDEX IF EXISTS consignees_client_consignee_code_unique');
        DB::statement("UPDATE consignees SET consignee_code = 'CN-' || LPAD(id::text, 3, '0')");
        DB::statement('ALTER TABLE consignees ADD CONSTRAINT consignees_consignee_code_unique UNIQUE (consignee_code)');
    }
};
