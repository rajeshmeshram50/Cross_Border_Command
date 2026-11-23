<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP INDEX IF EXISTS customers_client_customer_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX customers_client_branch_customer_code_unique '
            . 'ON customers (client_id, COALESCE(branch_id, 0), customer_code) '
            . 'WHERE deleted_at IS NULL'
        );

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
