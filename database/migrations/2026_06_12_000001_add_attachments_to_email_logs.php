<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persist the file attachments a user adds in the Gmail "Compose" box so the
 * reading pane can list + download them later (Gmail-style). The boolean
 * has_attachments already flags that a mail carried files; this column holds the
 * metadata for the composed ones: [{name, size, mime, path}]. Transactional
 * mails (OTP, payslips, …) keep has_attachments but do NOT store files here, so
 * the table doesn't balloon.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('email_logs', function (Blueprint $table) {
            $table->json('attachments')->nullable()->after('has_attachments');
        });
    }

    public function down(): void
    {
        Schema::table('email_logs', function (Blueprint $table) {
            $table->dropColumn('attachments');
        });
    }
};
