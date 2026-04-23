<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_rack_type_master', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('type_code', 255)->nullable();
            $table->string('type_name', 255)->nullable();
            $table->text('description')->nullable();
            $table->enum('suitable_for', ['General Inventory', 'Cold Chain', 'Hazardous', 'Heavy Duty', 'Retail', 'Pharma', 'All Types'])->nullable();
            $table->decimal('max_load_per_shelf', 18, 4)->nullable();
            $table->decimal('typical_shelves', 18, 4)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_rack_type_master');
    }
};
