<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_document_template_versions', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable();
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('template_id');

            $t->string('version', 10);
            $t->string('code', 32)->nullable();
            $t->string('name', 255)->nullable();
            $t->string('status', 20)->nullable();

            $t->string('editor_mode', 20)->nullable();
            $t->longText('content_html')->nullable();
            $t->json('header_config')->nullable();
            $t->json('footer_config')->nullable();

            $t->string('docx_path', 500)->nullable();
            $t->string('docx_original_name', 255)->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->timestamps();

            $t->index(['template_id', 'id']);
            $t->index('client_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_document_template_versions');
    }
};
