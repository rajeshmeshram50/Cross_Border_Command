<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_client_id_vendor_code_unique');
        DB::statement('DROP INDEX IF EXISTS vendors_client_id_vendor_code_unique');

        DB::statement(
            'CREATE UNIQUE INDEX vendors_client_branch_vendor_code_unique '
            . 'ON vendors (client_id, COALESCE(branch_id, 0), vendor_code)'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS vendors_client_branch_vendor_code_unique');
        DB::statement(
            'CREATE UNIQUE INDEX vendors_client_id_vendor_code_unique '
            . 'ON vendors (client_id, vendor_code)'
        );
    }
};
