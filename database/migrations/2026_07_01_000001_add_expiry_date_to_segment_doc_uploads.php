<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add an optional expiry date to segment-rule document uploads.
 *
 * The Stage 2 reference-row upload popup (Company DD / Owner KYC / Trade
 * License) lets the user flag whether the document carries an expiry and,
 * if so, pick the date. Nullable → "no expiry" (the Yes/No toggle sits on
 * No). When set, the Evidence Vault renders this uploaded expiry in place
 * of the segment-rule master's generic validity text.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('segment_doc_uploads')) {
            return;
        }
        if (Schema::hasColumn('segment_doc_uploads', 'expiry_date')) {
            return;
        }
        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->date('expiry_date')->nullable()->after('attachment_name');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('segment_doc_uploads', 'expiry_date')) {
            Schema::table('segment_doc_uploads', function (Blueprint $table) {
                $table->dropColumn('expiry_date');
            });
        }
    }
};
