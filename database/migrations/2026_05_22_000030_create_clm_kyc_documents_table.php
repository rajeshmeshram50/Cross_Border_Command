<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Central CLM → KYC Documents master.
 *
 * The customer/vendor onboarding document catalogue (PAN, Aadhaar, GST,
 * IEC, etc.). The Document Control Panel later picks rows from this table
 * and tags them Mandatory / Optional per segment.
 *
 * Authority is captured as a free-text string rather than an FK because the
 * prototype mixes formal authorities (UIDAI, GST Department) with descriptive
 * sources ("Bank / Utility / Govt Authority"). A formal FK would force every
 * value into the clm_authorities table and break that flexibility.
 *
 * `expiry` stores either 'N/A', 'Varies', or a 'MM/YYYY' string — matches the
 * prototype's column verbatim.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_kyc_documents', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();

            $table->string('code', 16);          // KYC-001
            $table->string('name', 255);         // PAN Card, Aadhaar Card, …
            $table->string('authority', 255);    // Free-text source
            $table->string('expiry', 32)->default('N/A');     // N/A | Varies | MM/YYYY

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
        Schema::dropIfExists('clm_kyc_documents');
    }
};
