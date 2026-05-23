<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Clause Library · Types tab.
 *
 * 8 clause-type buckets in the prototype (Core Legal, Commercial,
 * Financial, Risk, Regulatory, Operational, IP & Confidentiality, Dispute
 * & Arbitration). Library rows tag themselves with one of these names.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_clause_types', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // CLT-001
            $table->string('name', 255);
            /* Description was dropped from the Clause Type modal in the
             * redesign — kept on the schema for backward compatibility
             * but now nullable so the API can omit it. */
            $table->string('description', 500)->nullable();

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_clause_types');
    }
};
