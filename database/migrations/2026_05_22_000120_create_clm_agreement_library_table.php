<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Agreements · Library tab.
 *
 * Concrete agreement templates (Domestic Sales Contract, Export Sales
 * Contract, IT MSA, …). 56 of these seeded in the prototype, spanning
 * the 15 agreement types.
 *
 * `regulatory` is the same 'highly' / 'less' axis as segments but stored
 * by the template (not derived from the segment FK) because the prototype
 * uses 'high' literal value — we keep both shorthand and long form by
 * normalising in the controller.
 *
 * `signing` is a boolean flag for "signing pad / e-sign workflow required".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_agreement_library', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // A-001
            $table->string('agreement_type', 255);  // "Sales Contract", "MSA", … — keyed by name
            $table->string('title', 255);
            $table->string('party', 255);        // CSV ("Buyer, Supplier-Material")
            $table->string('regulatory', 16)->default('less');  // less | highly
            $table->boolean('signing')->default(true);
            $table->string('segment', 64)->nullable();           // Optional segment tag
            $table->string('agr_status', 32)->default('Active'); // Active | Draft

            $table->text('content')->nullable(); // Optional agreement body

            $table->string('status', 16)->default('active');     // Row activation

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'agreement_type']);
            $table->index(['client_id', 'regulatory']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_agreement_library');
    }
};
