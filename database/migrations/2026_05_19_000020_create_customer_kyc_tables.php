<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer Stage 2 — KYC / Due Diligence storage.
 *
 *  customer_documents
 *    Covers Company Due Diligence + Trade Licence sub-tabs. One row =
 *    one document captured against the customer (Certificate of
 *    Incorporation, GST Registration, etc.). `kind` segregates which
 *    sub-tab the row belongs to so the same table powers both lists.
 *
 *  customer_owners
 *    Covers the Owner KYC sub-tab. One row = one owner / authorized
 *    signatory of the customer, carrying their contact details and
 *    three identity proofs (ID, address, photograph).
 *
 *  Files are stored on the `public` disk under
 *    customer_documents/{customer_id}/...
 *  with only the relative path persisted to the row. Deleting the
 *  customer cascades the child rows; on-disk cleanup runs from the
 *  controllers when a row is removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customer_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();
            // 'dd' = Company Due Diligence, 'tl' = Trade Licence.
            // Owner KYC uses customer_owners (different shape).
            $table->string('kind', 8);

            $table->string('name', 255);
            $table->string('license_number', 128)->nullable();
            $table->string('issuing_authority', 255)->nullable();
            $table->date('issue_date')->nullable();
            $table->date('expiry_date')->nullable();
            $table->string('attachment_path', 500)->nullable();
            $table->text('description')->nullable();
            $table->string('status', 16)->default('Active');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['customer_id', 'kind']);
            $table->index('expiry_date');
        });

        Schema::create('customer_owners', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            $table->string('owner_name', 255);
            $table->string('designation', 128)->nullable();
            $table->string('official_email', 255)->nullable();
            $table->string('phone_number', 32)->nullable();

            $table->string('id_proof_path',      500)->nullable();
            $table->string('address_proof_path', 500)->nullable();
            $table->string('photograph_path',    500)->nullable();

            $table->string('status', 16)->default('Active');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index('customer_id');
            $table->index('official_email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('customer_owners');
        Schema::dropIfExists('customer_documents');
    }
};
