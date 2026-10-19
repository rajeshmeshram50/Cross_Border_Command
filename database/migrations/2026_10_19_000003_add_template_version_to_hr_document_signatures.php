<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The template version a signature run was SENT on. A run already freezes the
 * document body (content_html), so editing the template afterwards only bumps
 * the version for future sends — this records which version each sent document
 * is signing on, so the UI can show "signed on v2" while the template is now v3.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_document_signatures', function (Blueprint $t) {
            $t->string('template_version', 20)->nullable()->after('template_id');
        });
    }

    public function down(): void
    {
        Schema::table('hr_document_signatures', function (Blueprint $t) {
            $t->dropColumn('template_version');
        });
    }
};
