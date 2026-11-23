<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clm_signature_requests', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->unsignedBigInteger('trade_doc_id');
            $table->json('trade_doc_ids');
            $table->json('document_names');
            $table->json('zoho_document_ids')->nullable();

            $table->string('model_name', 32);
            $table->unsignedBigInteger('party_id');

            $table->string('zoho_request_id')->nullable()->index();
            $table->string('request_name');
            $table->string('status', 32)->default('draft')->index();

            $table->json('signers');
            $table->json('signing_urls')->nullable();

            $table->timestamp('expiry_date')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('declined_at')->nullable();
            $table->text('decline_reason')->nullable();
            $table->timestamp('recalled_at')->nullable();
            $table->text('recall_reason')->nullable();

            $table->string('signed_document_path', 500)->nullable();
            $table->json('signed_document_paths')->nullable();
            $table->string('certificate_path', 500)->nullable();

            $table->json('metadata')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('last_reminder_sent_at')->nullable();
            $table->unsignedInteger('reminder_count')->default(0);

            $table->timestamps();
            $table->softDeletes();

            $table->index(['model_name', 'party_id']);
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clm_signature_requests');
    }
};
