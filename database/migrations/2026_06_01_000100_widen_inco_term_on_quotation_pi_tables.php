<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * INCO Term is stored as the full master label the user picks (e.g.
     * "CIP – Carriage and Insurance Paid"), which overflows the original
     * varchar(16) and triggered "must not be greater than 16 characters".
     * Widen both the Quotation and Proforma Invoice columns so the full
     * term persists (matches the relaxed max:100 controller validation).
     */
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
