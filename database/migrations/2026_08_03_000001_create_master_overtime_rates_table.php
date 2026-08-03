<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_overtime_rates', function (Blueprint $table) {
            $table->id();
            // Tenant scope — NULL/NULL rows are super-admin "global" rates
            // visible to every client (see MasterVisibility::applyReadScope).
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('rate_name', 100);
            // Multiplier applied to the base hourly rate (e.g. 1.5 = 150%).
            $table->decimal('multiplier', 5, 2)->nullable();
            $table->string('description', 255)->nullable();
            $table->enum('status', ['Active', 'Inactive'])->default('Active');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('master_overtime_rates');
    }
};
