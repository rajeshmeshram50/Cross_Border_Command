<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Evidence-Vault uploads record when a document EXPIRES but never when it was
 * issued. The vault's row shape has carried an `issue_date` key since it was
 * written — hard-coded to null, because there was nowhere to read it from — and
 * the upload popup had no field to capture it. This gives that key a column.
 *
 * Nullable on purpose: every row already on file was uploaded without one, and
 * an issue date is genuinely optional for documents that do not carry one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->date('issue_date')->nullable()->after('attachment_name');
        });
    }

    public function down(): void
    {
        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->dropColumn('issue_date');
        });
    }
};
