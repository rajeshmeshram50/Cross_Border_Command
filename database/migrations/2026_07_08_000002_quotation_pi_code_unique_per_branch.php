<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quotation (QT/<FY>/<SEQ>) and Proforma Invoice (PI/<FY>/<SEQ>) codes are now
 * sequenced PER BRANCH (each branch restarts at 1), matching the per-branch
 * Shipment ID / OPP ID sequences. Two branches of the same client can therefore
 * legitimately both hold QT/2026-27/1, so the old per-client UNIQUE
 * (client_id, code) would wrongly reject the second branch's first document.
 *
 * Replace it with a per-(client, branch) composite unique on both tables.
 * Existing rows are already unique per client, hence trivially unique per
 * (client, branch), so this only widens — never violates — the constraint.
 * Note: Postgres treats NULL branch_id rows as mutually distinct, so
 * client-level (null-branch) documents are not de-duplicated by this index;
 * their sequence is allocated with whereNull('branch_id') in the app layer.
 *
 * The original create migrations added the unique with no explicit name, so
 * Laravel's default names apply: <table>_client_id_code_unique.
 */
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
