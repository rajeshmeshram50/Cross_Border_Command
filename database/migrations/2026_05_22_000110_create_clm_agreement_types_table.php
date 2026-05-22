<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Agreements · Types tab.
 *
 * Top-level agreement type catalogue (Sales Contract, MSA, NDA, Supplier,
 * Buyer, Distribution, …). The Library tab rows tag themselves with one
 * of these type names.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_agreement_types', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // AT-001
            $table->string('name', 255);
            $table->string('description', 500);

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_agreement_types');
    }
};
