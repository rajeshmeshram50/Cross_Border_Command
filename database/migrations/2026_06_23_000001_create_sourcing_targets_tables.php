<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Bulk Sourcing Management (Procure to Pay).
 *
 *  sourcing_targets         → one row per sourcing request the user raises.
 *                             Header: auto code (SRC-001, per-client), the
 *                             "source from" mode, start/due dates, and the
 *                             team member it is assigned to.
 *  sourcing_target_products → the product line items mapped to a target.
 *                             Either a Product Master reference (product_id +
 *                             snapshot fields) or a Manual Entry (free-text
 *                             name). Each row carries a target price, an
 *                             optional clarity note (text/link/pdf), and a
 *                             completion flag that drives the progress bar.
 *
 * Both tables are multi-tenant scoped (client_id always, branch_id when set)
 * and soft-deletable, matching the vendor/customer master conventions.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sourcing_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('code', 32);                  // SRC-001 (sequential per client)
            $table->string('source', 16)->default('master'); // master|manual — primary entry mode
            $table->date('start_date');
            $table->date('due_date');

            // Team member the sourcing is assigned to ("Assigned To").
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['client_id', 'code']);
            $table->index('branch_id');
            $table->index('assignee_id');
        });

        Schema::create('sourcing_target_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sourcing_target_id')->constrained('sourcing_targets')->cascadeOnDelete();

            $table->string('source', 16)->default('master'); // master|manual
            // Set for Product Master rows; null for Manual Entry. Snapshot the
            // code/segment/hsn so the line survives later product edits.
            $table->foreignId('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_code', 64)->nullable();
            $table->string('product_name', 500);
            $table->string('segment', 255)->nullable();
            $table->string('hsn_code', 32)->nullable();
            $table->decimal('target_price', 15, 2)->nullable();

            // Optional per-product clarity: text note, reference link, or PDF.
            $table->string('clarity_type', 8)->nullable();   // text|link|pdf
            $table->text('clarity_value')->nullable();       // note text or URL
            $table->string('clarity_path', 500)->nullable(); // stored PDF path

            $table->boolean('is_completed')->default(false); // drives progress %

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('sourcing_target_id');
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sourcing_target_products');
        Schema::dropIfExists('sourcing_targets');
    }
};
