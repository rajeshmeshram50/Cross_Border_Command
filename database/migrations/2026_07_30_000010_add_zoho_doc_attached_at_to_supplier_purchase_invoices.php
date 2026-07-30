<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tracks when a supplier purchase invoice's uploaded document was attached to its
 * linked PO's Zoho purchase order (and bill). Null = not yet pushed, which is what
 * keeps the "Sync Attachment" button visible and guards against re-attaching the
 * same file twice (Zoho's attachment endpoint appends, so it would duplicate).
 */
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
