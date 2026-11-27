<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quotations', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->string('code', 32);
            $table->unsignedSmallInteger('version')->default(1);

            $table->string('doc_type', 16)->default('International');

            $table->foreignId('opp_id')->nullable()
                  ->constrained('leads')->nullOnDelete();
            $table->string('opp_code', 32)->nullable();
            $table->date('opportunity_date')->nullable();

            $table->foreignId('customer_id')->constrained('customers')->restrictOnDelete();
            $table->string('customer_name', 255)->nullable();

            $table->foreignId('consignee_id')->nullable()
                  ->constrained('consignees')->nullOnDelete();
            $table->string('consignee_name', 255)->nullable();

            $table->unsignedBigInteger('bank_account_id')->nullable()->index();
            $table->string('bank_label', 255)->nullable();

            $table->string('currency', 8)->nullable();
            $table->decimal('exchange_rate', 12, 4)->nullable();

            $table->string('inco_term', 16)->nullable();
            $table->string('port_of_loading', 128)->nullable();
            $table->string('port_of_discharge', 128)->nullable();
            $table->string('final_destination', 128)->nullable();
            $table->string('origin_country', 64)->nullable();

            $table->string('state_code', 64)->nullable();

            $table->foreignId('sales_manager_id')->nullable()
                  ->constrained('users')->nullOnDelete();
            $table->string('sales_manager_name', 128)->nullable();

            $table->decimal('sub_total',   14, 2)->default(0);
            $table->decimal('shipping',    14, 2)->default(0);
            $table->decimal('grand_total', 14, 2)->default(0);

            $table->string('status', 24)->default('draft');

            $table->text('terms')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'code']);

            $table->index(['client_id', 'status']);
            $table->index(['client_id', 'customer_id']);
            $table->index(['client_id', 'opp_id']);
            $table->index(['client_id', 'doc_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quotations');
    }
};
