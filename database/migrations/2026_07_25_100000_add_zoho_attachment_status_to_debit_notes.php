<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('debit_notes', function (Blueprint $table) {
            // Tracks the async "attach system debit-note document to Zoho" job so
            // the sync loader can wait for it: queued | done | failed (null = never
            // queued). Mirrors purchase_orders.zoho_attachment_status.
            $table->string('zoho_attachment_status', 20)->nullable()->after('zoho_pdf_path');
        });
    }

    public function down(): void
    {
        Schema::table('debit_notes', function (Blueprint $table) {
            $table->dropColumn('zoho_attachment_status');
        });
    }
};
