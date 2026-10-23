<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/* The signed PDF is rendered ONCE when the run completes and kept.
 * Before this, every download re-rendered it from content_html plus the
 * signature images — so the "signed document" handed over a year later
 * depended on those files still existing and on DomPDF still laying the
 * page out the same way. A stored file is the evidence; the column points
 * at it. signed_pdf_at is compared against updated_at to spot a stale one. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_document_signatures', function (Blueprint $table) {
            $table->string('signed_pdf_path', 512)->nullable()->after('audit_log');
            $table->timestamp('signed_pdf_at')->nullable()->after('signed_pdf_path');
        });
    }

    public function down(): void
    {
        Schema::table('hr_document_signatures', function (Blueprint $table) {
            $table->dropColumn(['signed_pdf_path', 'signed_pdf_at']);
        });
    }
};
