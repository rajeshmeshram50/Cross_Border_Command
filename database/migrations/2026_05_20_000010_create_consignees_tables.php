<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('consignees', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            $table->string('consignee_code', 32)->nullable()->unique();

            $table->string('company_name', 255);
            $table->string('legal_name', 255)->nullable();
            $table->string('segment', 64)->nullable();
            $table->string('classification', 64)->nullable();
            $table->string('risk_level', 32)->nullable();
            $table->string('website', 500)->nullable();

            $table->string('primary_email', 255)->nullable();

            $table->string('status', 16)->default('Active');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index('status');
            $table->index('classification');
            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'primary_email']);
            $table->index('customer_id');
        });

        Schema::create('consignee_addresses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('consignee_id')->constrained('consignees')->cascadeOnDelete();

            $table->string('type', 64);
            $table->text('address_line');
            $table->string('country', 64)->nullable();
            $table->string('state', 64)->nullable();
            $table->string('city', 64)->nullable();
            $table->string('pin', 16)->nullable();

            $table->string('cp_name', 255);
            $table->string('cp_designation', 128)->nullable();
            $table->string('cp_contact', 32)->nullable();
            $table->string('cp_email', 255)->nullable();
            $table->string('cp_whatsapp', 4)->nullable();

            $table->boolean('is_primary')->default(false);

            $table->timestamps();

            $table->index('consignee_id');
            $table->index(['consignee_id', 'is_primary']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('consignee_addresses');
        Schema::dropIfExists('consignees');
    }
};
