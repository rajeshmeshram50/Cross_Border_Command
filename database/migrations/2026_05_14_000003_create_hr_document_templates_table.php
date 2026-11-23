<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_document_templates', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 32)->nullable()->index();
            $table->string('name', 255)->nullable();
            $table->text('description')->nullable();

            $table->enum('employee_category', ['IT', 'Non-IT', 'Legal'])->nullable()->index();
            $table->enum('role_type', ['Intern', 'Employee', 'Executive', 'HOD'])->nullable()->index();
            $table->string('doc_type', 100)->nullable();
            $table->unsignedBigInteger('trigger_point_id')->nullable()->index();

            $table->string('version', 10)->default('v1');

            $table->boolean('is_mandatory')->default(false);
            $table->boolean('requires_signature')->default(false);
            $table->boolean('requires_manager_approval')->default(false);
            $table->boolean('include_in_audit')->default(true);

            $table->enum('signing_mode', ['Sequential', 'Parallel'])->default('Sequential');
            $table->json('signers')->nullable();

            $table->enum('editor_mode', ['web', 'word'])->default('web');
            $table->longText('content_html')->nullable();
            $table->string('docx_path', 500)->nullable();
            $table->string('docx_original_name', 255)->nullable();

            $table->enum('status', ['Draft', 'Active', 'Deprecated'])->default('Draft')->index();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_document_templates');
    }
};
