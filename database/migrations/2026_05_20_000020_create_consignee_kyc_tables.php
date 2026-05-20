<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Consignee Stage 2 — KYC / Due Diligence storage.
 *
 * Mirrors customer_documents + customer_owners 1:1 (same column
 * shape, same file-storage strategy). Only the parent FK changes
 * from customer_id → consignee_id.
 *
 *  consignee_documents — Company DD + Trade Licence (kind: 'dd'|'tl')
 *  consignee_owners    — Owner KYC rows with three identity proofs
 *
 * Files land on the public disk under
 *   consignee_documents/{consignee_id}/...
 * Only the relative path is persisted. Deleting the parent consignee
 * cascade-deletes both children; on-disk cleanup happens in the
 * matching controllers when a single row is removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consignee_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('consignee_id')->constrained('consignees')->cascadeOnDelete();
            // 'dd' = Company Due Diligence, 'tl' = Trade Licence.
            // Owner KYC uses consignee_owners (different shape).
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

            $table->index(['consignee_id', 'kind']);
            $table->index('expiry_date');
        });

        Schema::create('consignee_owners', function (Blueprint $table) {
            $table->id();
            $table->foreignId('consignee_id')->constrained('consignees')->cascadeOnDelete();

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

            $table->index('consignee_id');
            $table->index('official_email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consignee_owners');
        Schema::dropIfExists('consignee_documents');
    }
};
