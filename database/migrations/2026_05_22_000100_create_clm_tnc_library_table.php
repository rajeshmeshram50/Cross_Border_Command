<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Terms & Conditions · Library tab.
 *
 * Reusable T&C blocks. Each row belongs to a Category from
 * `clm_tnc_categories` (referenced by name to stay tolerant of renames,
 * mirroring the prototype's structure) and carries the parties involved
 * as a CSV string.
 *
 * `segment` is also a free-text label here because the prototype treated
 * "General" as a valid segment label that doesn't appear in clm_segments.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_tnc_library', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // TNC-001
            $table->string('segment', 64)->default('General');
            $table->string('category', 255);     // T&C category name
            $table->string('party', 255);        // CSV

            $table->text('content')->nullable(); // Optional clause body

            $table->string('status', 16)->default('active');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);
            $table->index(['client_id', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_tnc_library');
    }
};
