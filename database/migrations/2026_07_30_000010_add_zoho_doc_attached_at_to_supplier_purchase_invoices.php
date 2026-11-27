<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->timestamp('zoho_doc_attached_at')->nullable()->after('zoho_pdf_path');
        });
    }

    public function down(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->dropColumn('zoho_doc_attached_at');
        });
    }
};
