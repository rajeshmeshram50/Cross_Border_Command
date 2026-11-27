<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('quotations', function (Blueprint $table) {
            $table->dropUnique('quotations_client_id_code_unique');
            $table->unique(['client_id', 'branch_id', 'code'], 'quotations_client_branch_code_unique');
        });

        Schema::table('proforma_invoices', function (Blueprint $table) {
            $table->dropUnique('proforma_invoices_client_id_code_unique');
            $table->unique(['client_id', 'branch_id', 'code'], 'proforma_invoices_client_branch_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('quotations', function (Blueprint $table) {
            $table->dropUnique('quotations_client_branch_code_unique');
            $table->unique(['client_id', 'code'], 'quotations_client_id_code_unique');
        });

        Schema::table('proforma_invoices', function (Blueprint $table) {
            $table->dropUnique('proforma_invoices_client_branch_code_unique');
            $table->unique(['client_id', 'code'], 'proforma_invoices_client_id_code_unique');
        });
    }
};
