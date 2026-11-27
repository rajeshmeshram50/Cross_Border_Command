<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_document_templates', function (Blueprint $t) {
            $t->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::table('hr_document_templates', function (Blueprint $t) {
            $t->dropSoftDeletes();
        });
    }
};
