<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->decimal('tds_percentage', 6, 2)->default(0)->after('net_payable');
            $table->decimal('tds_amount', 14, 2)->default(0)->after('tds_percentage');
            $table->boolean('tds_cut')->default(false)->after('tds_amount');
        });

        Schema::create('spi_payments', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            $table->foreignId('supplier_purchase_invoice_id')->constrained('supplier_purchase_invoices')->cascadeOnDelete();

            $table->decimal('amount', 14, 2)->default(0);
            $table->string('bank_name', 128)->nullable();
            $table->string('utr_cheque_number', 64)->nullable();
            $table->date('utr_cheque_date')->nullable();
            $table->string('attachment_path', 500)->nullable();
            $table->decimal('balance_after', 14, 2)->default(0);
            $table->string('status', 24)->default('Cleared');

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['supplier_purchase_invoice_id', 'id']);
            $table->index(['client_id', 'supplier_purchase_invoice_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('spi_payments');
        Schema::table('supplier_purchase_invoices', function (Blueprint $table) {
            $table->dropColumn(['tds_percentage', 'tds_amount', 'tds_cut']);
        });
    }
};
