<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_documents', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('document_key', 60)->index();

            $table->string('file_path', 500)->nullable();
            $table->string('original_name', 255)->nullable();
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();

            $table->enum('status', ['pending', 'uploaded', 'verified', 'rejected'])
                  ->default('uploaded');
            $table->text('rejection_reason')->nullable();

            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->timestamp('uploaded_at')->nullable();
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->timestamp('verified_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->unique(['employee_id', 'document_key'], 'employee_documents_emp_key_unique');
            $table->index(['client_id', 'branch_id', 'status'], 'employee_documents_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_documents');
    }
};
