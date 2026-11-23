<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendors', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('vendor_code', 32)->nullable()->unique();

            $table->string('company_name', 255);
            $table->string('legal_name', 255)->nullable();
            $table->string('website', 500)->nullable();

            $table->foreignId('vendor_type_id')->nullable()->constrained('master_vendor_types')->nullOnDelete();
            $table->foreignId('risk_level_id')->nullable()->constrained('master_risk_levels')->nullOnDelete();
            $table->foreignId('vendor_behaviour_id')->nullable()->constrained('master_vendor_behaviour')->nullOnDelete();
            $table->foreignId('segment_id')->nullable()->constrained('master_segments')->nullOnDelete();
            $table->foreignId('compliance_behaviour_id')->nullable()->constrained('master_compliance_behaviours')->nullOnDelete();

            $table->string('primary_email', 255)->nullable();

            $table->string('status', 16)->default('draft');

            $table->unsignedTinyInteger('step_completed')->default(0);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'primary_email']);
        });

        Schema::create('vendor_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->cascadeOnDelete();

            $table->text('address_line')->nullable();
            $table->foreignId('country_id')->nullable()->constrained('master_countries')->nullOnDelete();
            $table->foreignId('state_id')->nullable()->constrained('master_states')->nullOnDelete();
            $table->string('state_code', 32)->nullable();
            $table->string('city', 128)->nullable();
            $table->string('pincode', 16)->nullable();

            $table->string('contact_name', 255);
            $table->string('designation', 128)->nullable();
            $table->string('contact_no', 32)->nullable();
            $table->string('email', 255)->nullable();
            $table->boolean('whatsapp_enabled')->default(true);

            $table->string('attachment_path', 500)->nullable();

            $table->boolean('is_primary')->default(false);

            $table->timestamps();

            $table->index('vendor_id');
            $table->index(['vendor_id', 'is_primary']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_addresses');
        Schema::dropIfExists('vendors');
    }
};
