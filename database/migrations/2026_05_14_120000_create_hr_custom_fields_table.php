<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_custom_fields', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('name', 100);
            $table->enum('type', ['text', 'date', 'number', 'textarea'])->default('text');
            $table->string('description', 500)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            $table->unique(['client_id', 'branch_id', 'name'], 'hr_custom_fields_tenant_name_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_custom_fields');
    }
};
