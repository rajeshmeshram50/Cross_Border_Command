<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leads', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('opp_code', 32)->unique();
            $table->string('unique_query_id', 64)->nullable();

            $table->string('platform', 32);
            $table->string('query_type', 32);
            $table->string('source_account', 64)->nullable();
            $table->timestamp('query_time')->nullable();

            $table->string('sender_name', 255);
            $table->string('sender_mobile', 32)->nullable();
            $table->string('sender_email', 255)->nullable();
            $table->string('sender_company', 255)->nullable();
            $table->text  ('sender_address')->nullable();
            $table->string('sender_city', 128)->nullable();
            $table->string('sender_state', 128)->nullable();
            $table->string('sender_pincode', 32)->nullable();
            $table->string('sender_country_iso', 8)->nullable();
            $table->string('sender_country_name', 128)->nullable();
            $table->string('sender_mobile_alt', 32)->nullable();
            $table->string('sender_email_alt', 255)->nullable();

            $table->string('query_product_name', 255)->nullable();
            $table->text  ('query_message')->nullable();
            $table->string('product_quantity', 64)->nullable();
            $table->string('query_mcat_name', 255)->nullable();

            $table->unsignedTinyInteger('lead_stage_id')->default(1);
            $table->boolean('qualified')->default(true);
            $table->boolean('disqualified')->default(false);
            $table->boolean('key_opportunity')->default(false);

            $table->boolean('has_whatsapp')->default(false);
            $table->text  ('whatsapp_reason')->nullable();
            $table->string('whatsapp_screenshot', 500)->nullable();
            $table->string('whatsapp_status', 16)->default('pending');

            $table->foreignId('salesperson_id')->nullable()->constrained('users')->nullOnDelete();

            $table->foreignId('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->foreignId('consignee_id')->nullable()->constrained('consignees')->nullOnDelete();

            $table->foreignId('lead_ack_reason_id')->nullable()->constrained('lead_ack_reasons')->nullOnDelete();

            $table->text('remark')->nullable();
            $table->string('price', 64)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id']);
            $table->index(['client_id', 'qualified', 'disqualified']);
            $table->index(['client_id', 'salesperson_id']);
            $table->index(['client_id', 'platform']);
            $table->index(['client_id', 'query_time']);

            $table->unique(['client_id', 'platform', 'unique_query_id'], 'leads_external_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leads');
    }
};
