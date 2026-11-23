<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('segment_doc_uploads')) {
            return;
        }
        Schema::create('segment_doc_uploads', function (Blueprint $table) {
            $table->id();
            $table->morphs('uploadable');
            $table->unsignedBigInteger('client_id')->index();
            $table->string('category', 8);
            $table->string('doc_code', 32);
            $table->string('doc_name');
            $table->char('requirement', 1)->default('O');
            $table->string('attachment_path');
            $table->string('attachment_name');
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->timestamps();

            $table->unique(['uploadable_type', 'uploadable_id', 'category', 'doc_code'], 'seg_uploads_unique_per_doc');
            $table->index(['client_id', 'uploadable_type', 'uploadable_id'], 'seg_uploads_tenant_owner_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('segment_doc_uploads');
    }
};
