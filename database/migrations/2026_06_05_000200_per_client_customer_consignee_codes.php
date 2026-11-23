<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
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
        DB::statement('DROP INDEX IF EXISTS customers_client_customer_code_unique');
        DB::statement("UPDATE customers SET customer_code = 'C-' || LPAD(id::text, 3, '0')");
        DB::statement('ALTER TABLE customers ADD CONSTRAINT customers_customer_code_unique UNIQUE (customer_code)');

        DB::statement('DROP INDEX IF EXISTS consignees_client_consignee_code_unique');
        DB::statement("UPDATE consignees SET consignee_code = 'CN-' || LPAD(id::text, 3, '0')");
        DB::statement('ALTER TABLE consignees ADD CONSTRAINT consignees_consignee_code_unique UNIQUE (consignee_code)');
    }
};
