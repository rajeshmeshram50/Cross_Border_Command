<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            $table->string('kind', 8);

            $table->string('code', 32)->nullable();

            $table->string('document_name', 255)->nullable();
            $table->foreignId('license_type_id')->nullable()->constrained('master_license_name')->nullOnDelete();

            $table->string('license_number', 128)->nullable();
            $table->string('issuing_authority', 255)->nullable();

            $table->string('expiry', 32)->nullable();
            $table->date('issue_date')->nullable();
            $table->date('expiry_date')->nullable();

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

            $table->string('code', 32)->nullable();

            $table->string('document_name', 255);
            $table->string('issuing_authority', 255)->nullable();
            $table->string('document_number', 128)->nullable();
            $table->date('issue_date')->nullable();
            $table->string('expiry', 32)->nullable();
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
            $table->string('status', 16)->default('Active');
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
