<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consignee_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('consignee_id')->constrained('consignees')->cascadeOnDelete();
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
