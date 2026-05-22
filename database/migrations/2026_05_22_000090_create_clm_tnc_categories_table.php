<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Terms & Conditions · Categories tab.
 *
 * The buckets ("International - Proforma Invoice", "Domestic - GPO", …)
 * that the T&C library rows live under. `short_code` is the prototype's
 * 4-letter abbreviation (IPI, DPI, IGPO, DGPO, …) used on small chips.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_tnc_categories', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // DC-001
            $table->string('short_code', 12);    // IPI, DPI, IGPO, …
            $table->string('name', 255);

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_tnc_categories');
    }
};
