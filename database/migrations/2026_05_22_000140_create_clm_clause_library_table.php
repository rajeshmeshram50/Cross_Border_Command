<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Clause Library · Library tab.
 *
 * Reusable individual clauses (Force Majeure, Governing Law, Payment Terms
 * Net 30, Liability Cap, Arbitration, NDA-5y, …). Each row carries a
 * Type name (matching a row in clm_clause_types) and a party CSV.
 *
 * `content` holds the actual clause body so authoring tools elsewhere in
 * the app can insert it verbatim into an agreement.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_clause_library', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // CL-001
            $table->string('clause_type', 255);  // "Core Legal", "Financial", …
            $table->string('name', 255);
            $table->string('party', 255);        // CSV
            $table->string('clause_status', 32)->default('Active');  // Active | Draft

            $table->text('content')->nullable();

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'clause_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_clause_library');
    }
};
