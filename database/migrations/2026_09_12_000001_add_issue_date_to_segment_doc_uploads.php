<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Evidence Vault documents carry an expiry but never carried an ISSUE date.
 *
 * The vault response has always had an `issue_date` key — hardcoded to null,
 * because there was nowhere to read one from. So the Evidence Vault could show
 * when a document lapses but not when it was granted, and the upload dialog had
 * no way to record it (QA #78, #79, #80).
 *
 * Nullable: every row already on file was uploaded without one, and plenty of
 * documents genuinely have no issue date worth recording.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('segment_doc_uploads', 'issue_date')) {
            return;
        }

        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            // Beside expiry_date — the two are read and written together.
            $table->date('issue_date')->nullable()->after('attachment_name');
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('segment_doc_uploads', 'issue_date')) {
            return;
        }

        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->dropColumn('issue_date');
        });
    }
};
