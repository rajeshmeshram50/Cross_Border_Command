<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
