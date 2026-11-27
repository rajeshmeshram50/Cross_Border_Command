<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
