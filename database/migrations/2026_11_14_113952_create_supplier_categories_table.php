<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_supplier_categories', function (Blueprint $table) {
            $table->id();

            // Ownership columns (No foreign key constraints, just indexes)
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable()->index();

            // Custom Fields
            $table->string('name');
            $table->enum('supplier_service', ['self', 'other'])->default('self');
            $table->string('supplier_type')->nullable(); // Only used if supplier_service = 'other'

            // Status as boolean (0 = inactive, 1 = active)
            $table->boolean('status')->default(1);

            $table->boolean('is_system')->default(false);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_supplier_categories');
    }
};
