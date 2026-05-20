<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Vendor Stage 2 — KYC / Due Diligence storage.
 *
 * Four tables back the five KYC sub-tabs:
 *
 *  vendor_documents  → Company Due Diligence (kind='dd')
 *                    + Trade License (kind='tl')
 *                    `license_type_id` is only meaningful for kind='tl'
 *                    (FK to master_license_name).
 *
 *  vendor_owners     → Owner KYC. One row per owner / authorized
 *                    signatory with a single attachment (PAN, Aadhaar,
 *                    passport, etc.).
 *
 *  vendor_bank_accounts → Vendor Bank Details. One row per bank account
 *                    with the cancelled-cheque file.
 *
 *  vendor_gst_scrutiny → GST Scrutiny entries (one per GST number the
 *                    vendor is registered under).
 *
 *  Files land on the `public` disk under
 *    vendor_documents/{vendor_id}/{slug}-{rand}.{ext}
 *  with only the relative path persisted. Cascading delete on
 *  vendor_id removes the rows; the controller cleans up on-disk
 *  files when a row is removed during a step's replace-all save.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            // 'dd' = Company Due Diligence, 'tl' = Trade License.
            $table->string('kind', 8);

            // User-facing auto code (DD-001, TL-001). Recomputed by the
            // controller on each replace-all save so codes stay
            // contiguous after deletions.
            $table->string('code', 32)->nullable();

            // Document name — free text for kind='dd' (e.g. "Certificate
            // of Incorporation"). For kind='tl' the dropdown stores
            // license_type_id; document_name is left null but the
            // license_name master's row provides the display label.
            $table->string('document_name', 255)->nullable();
            $table->foreignId('license_type_id')->nullable()->constrained('master_license_name')->nullOnDelete();

            $table->string('license_number', 128)->nullable(); // TL only
            $table->string('issuing_authority', 255)->nullable();

            // DD uses free-text expiry ('N/A' or 'MM/YYYY'); TL uses
            // proper date fields so the dashboard can flag near-expiry.
            $table->string('expiry', 32)->nullable();         // dd only
            $table->date('issue_date')->nullable();           // tl only
            $table->date('expiry_date')->nullable();          // tl only

            // DD only — mandatory rows can't be deleted on the frontend.
            $table->boolean('mandatory')->default(false);

            $table->string('attachment_path', 500)->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['vendor_id', 'kind']);
            $table->index('expiry_date');
        });

        Schema::create('vendor_owners', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            // KYC-001, KYC-002 …
            $table->string('code', 32)->nullable();

            $table->string('document_name', 255);             // PAN Card, Aadhaar…
            $table->string('issuing_authority', 255)->nullable();
            $table->string('document_number', 128)->nullable();
            $table->date('issue_date')->nullable();
            $table->string('expiry', 32)->nullable();         // 'MM/YYYY' or 'N/A'
            $table->string('status', 16)->default('Active');

            $table->string('attachment_path', 500)->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('vendor_id');
        });

        Schema::create('vendor_bank_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            $table->string('bank_name', 255);
            $table->string('branch_name', 255);
            $table->string('account_number', 64);
            $table->string('ifsc', 16);
            $table->string('branch_address', 500)->nullable();
            $table->string('cheque_path', 500)->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('vendor_id');
            $table->index('ifsc');
        });

        Schema::create('vendor_gst_scrutiny', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            $table->string('gst_number', 16);
            $table->string('status', 16)->default('Active');   // Active|Suspended|Cancelled
            $table->date('last_filing_date')->nullable();
            $table->string('prev_non_gst_2a_invoice', 255)->nullable();
            $table->text('red_flags')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('vendor_id');
            $table->index('gst_number');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_gst_scrutiny');
        Schema::dropIfExists('vendor_bank_accounts');
        Schema::dropIfExists('vendor_owners');
        Schema::dropIfExists('vendor_documents');
    }
};
