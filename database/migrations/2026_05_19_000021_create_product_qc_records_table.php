<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_qc_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('qc_name', 100);
            $table->string('qc_purpose', 255)->nullable();
            $table->string('issued_by', 255)->nullable();
            $table->text('qa_testing_parameter')->nullable();
            $table->text('min_acceptance_criteria')->nullable();
            $table->string('attachment_path', 500)->nullable();
            $table->timestamps();

            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_qc_records');
    }
};
