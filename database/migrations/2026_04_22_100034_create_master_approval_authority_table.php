<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_approval_authority', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('role_name', 255)->nullable();
            $table->enum('module_scope', ['Purchase Order', 'Payment', 'VTI', 'GRN', 'All'])->nullable();
            $table->decimal('min_value', 18, 4)->nullable();
            $table->decimal('max_value', 18, 4)->nullable();
            $table->enum('currency', ['INR', 'USD', 'EUR', 'GBP'])->nullable();
            $table->string('escalate_to', 255)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_approval_authority');
    }
};
