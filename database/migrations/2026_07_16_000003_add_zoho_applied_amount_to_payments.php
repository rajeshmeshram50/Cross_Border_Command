<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['po_payments', 'spi_payments'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->decimal('zoho_applied_amount', 14, 2)->default(0)->after('zoho_payment_id');
            });
        }
    }

    public function down(): void
    {
        foreach (['po_payments', 'spi_payments'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn('zoho_applied_amount');
            });
        }
    }
};
