<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_advance_payment_rules', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('vendor_type', 255)->nullable();
            $table->string('procurement_cat', 255)->nullable();
            $table->decimal('max_advance_pct', 18, 4)->nullable();
            $table->decimal('approval_above', 18, 4)->nullable();
            $table->string('approver_role', 255)->nullable();
            $table->enum('attachment_required', ['Yes', 'No'])->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_advance_payment_rules');
    }
};
