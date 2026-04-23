<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_payment_terms', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('term_code', 255)->nullable();
            $table->string('term_name', 255)->nullable();
            $table->decimal('credit_days', 18, 4)->nullable();
            $table->decimal('advance_pct', 18, 4)->nullable();
            $table->enum('payment_type', ['Full Advance', 'Partial Advance', 'Credit', 'Milestone-Based', 'COD'])->nullable();
            $table->string('milestone_desc', 255)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_payment_terms');
    }
};
