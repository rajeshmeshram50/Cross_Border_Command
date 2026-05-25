<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Stage 3 (Sourcing Required tab) creates a Procurement to
 * group one or more lead⇄product rows under a single sourcing assignment.
 *
 * Ported from New_IDIMS_6.0's `procurements` table — multi-tenant via
 * `client_id`, optional `lead_id` because procurements can also exist
 * outside a specific lead (master-level procurements) once the module
 * grows. `attachments` is a JSON list of stored file paths.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('procurements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('lead_id')->nullable()->constrained('leads')->nullOnDelete();
            $table->date('procurement_date')->nullable(); // TAT date the salesperson picks
            $table->foreignId('assign_id')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('status', ['inprogress', 'done'])->default('inprogress');
            $table->json('attachments')->nullable(); // procurement-level uploads
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['client_id', 'lead_id']);
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('procurements');
    }
};
