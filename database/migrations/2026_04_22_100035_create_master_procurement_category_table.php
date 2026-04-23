<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_procurement_category', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('cat_code', 255)->nullable();
            $table->string('cat_name', 255)->nullable();
            $table->enum('match_logic', ['3-Way Match (PO+VTI+GRN)', '2-Way Match (PO+VTI)', '4-Way Match (PO+VTI+GRN+QC)'])->nullable();
            $table->enum('grn_required', ['Yes — Physical Receipt', 'Yes — Service Confirmation', 'No'])->nullable();
            $table->enum('gst_applicable', ['Yes', 'No', 'Reverse Charge'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_procurement_category');
    }
};
