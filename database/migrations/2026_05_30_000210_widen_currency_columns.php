<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['lead_products', 'quotations', 'proforma_invoices'] as $table) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'currency')) continue;
            Schema::table($table, function (Blueprint $t) {
                $t->string('currency', 64)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
    }
};
