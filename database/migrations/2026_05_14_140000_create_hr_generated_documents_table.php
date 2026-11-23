<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_generated_documents', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->unsignedBigInteger('template_id')->index();
            $table->unsignedBigInteger('employee_id')->index();

            $table->longText('rendered_html')->nullable();

            $table->json('custom_values')->nullable();

            $table->json('resolved_vars')->nullable();

            $table->enum('status', ['Draft', 'Generated', 'Sent', 'Viewed', 'Acknowledged', 'Signed'])
                ->default('Generated')->index();

            $table->unsignedBigInteger('generated_by')->nullable();
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_generated_documents');
    }
};
