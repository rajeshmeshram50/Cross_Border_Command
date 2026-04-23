<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_temp_class_master', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('class_code', 255)->nullable();
            $table->string('class_name', 255)->nullable();
            $table->decimal('temp_range_min', 18, 4)->nullable();
            $table->decimal('temp_range_max', 18, 4)->nullable();
            $table->text('description')->nullable();
            $table->enum('requires_monitoring', ['No', 'Yes'])->nullable();
            $table->decimal('alert_threshold', 18, 4)->nullable();
            $table->string('suitable_products', 255)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_temp_class_master');
    }
};
