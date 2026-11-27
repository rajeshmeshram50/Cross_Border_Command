<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        foreach (['quotations', 'proforma_invoices'] as $table) {
            if (Schema::hasColumn($table, 'inco_term')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->string('inco_term', 100)->nullable()->change();
                });
            }
        }
    }

    public function down(): void
    {
        foreach (['quotations', 'proforma_invoices'] as $table) {
            if (Schema::hasColumn($table, 'inco_term')) {
                Schema::table($table, function (Blueprint $t) {
                    $t->string('inco_term', 16)->nullable()->change();
                });
            }
        }
    }
};
