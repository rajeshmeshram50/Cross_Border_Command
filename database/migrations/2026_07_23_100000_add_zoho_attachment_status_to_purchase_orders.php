<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            // Tracks the async "attach system PO document to Zoho" job so the sync
            // loader can wait for it: queued | done | failed (null = never queued).
            $table->string('zoho_attachment_status', 20)->nullable()->after('zoho_pdf_path');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->dropColumn('zoho_attachment_status');
        });
    }
};
