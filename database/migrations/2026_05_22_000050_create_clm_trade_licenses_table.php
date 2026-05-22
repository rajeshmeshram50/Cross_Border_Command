<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Trade Licences master.
 *
 * Statutory trade licences (GST registration, IEC, AD Code, FSSAI, drug
 * licence, BIS/ISI, …). The prototype called this column `validity` instead
 * of `expiry`; the only difference is naming.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_trade_licenses', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // TL-001
            $table->string('name', 255);
            $table->string('authority', 255);
            $table->string('validity', 32)->default('N/A');   // N/A | MM/YYYY

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_trade_licenses');
    }
};
