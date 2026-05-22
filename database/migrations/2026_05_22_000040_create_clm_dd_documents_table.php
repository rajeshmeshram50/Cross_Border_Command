<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → Due Diligence master.
 *
 * Entity-level diligence documents (incorporation cert, MOA/AOA, board
 * resolution, audited financials, CIBIL report, …). Same shape as KYC —
 * code, name, free-text authority, expiry — but counts as a separate
 * category for the Document Control Panel matrix.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_dd_documents', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // DD-001
            $table->string('name', 255);
            $table->string('authority', 255);
            $table->string('expiry', 32)->default('N/A');

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
        Schema::dropIfExists('clm_dd_documents');
    }
};
