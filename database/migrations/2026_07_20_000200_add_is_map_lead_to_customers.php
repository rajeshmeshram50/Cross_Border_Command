<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('is_map_lead', 8)->default('No')->after('status');
        });

        DB::statement(<<<'SQL'
            UPDATE customers
               SET is_map_lead = 'Yes'
             WHERE EXISTS (
                   SELECT 1 FROM leads
                    WHERE leads.customer_id = customers.id
                      AND leads.deleted_at IS NULL
             )
        SQL);
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn('is_map_lead');
        });
    }
};
