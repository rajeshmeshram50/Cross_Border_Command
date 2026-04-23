<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_deviation_reason', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('reason_code', 255)->nullable();
            $table->string('reason_name', 255)->nullable();
            $table->enum('module', ['Purchase Order', 'Vendor Comparison', 'VTI', 'GRN', 'Payment', 'All'])->nullable();
            $table->enum('attachment_required', ['Yes', 'No'])->nullable();
            $table->enum('requires_approval', ['Yes', 'No'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_deviation_reason');
    }
};
