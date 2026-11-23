<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_document_signatures', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->unsignedBigInteger('template_id')->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->string('code', 64)->nullable()->index();

            $table->longText('content_html')->nullable();
            $table->json('header_config')->nullable();
            $table->json('footer_config')->nullable();

            $table->json('signers')->nullable();
            $table->unsignedSmallInteger('current_index')->default(0);

            $table->enum('status', ['Pending', 'In Progress', 'Completed', 'Rejected', 'Cancelled'])
                  ->default('Pending')->index();

            $table->json('audit_log')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_document_signatures');
    }
};
