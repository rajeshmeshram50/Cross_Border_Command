<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_supplier_invoices', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->index();

            $t->string('code', 30);
            $t->unsignedBigInteger('purchase_order_id')->nullable()->index();
            $t->unsignedBigInteger('vendor_id')->index();

            $t->string('invoice_no', 60)->nullable();
            $t->date('invoice_date')->nullable();
            $t->string('invoice_file_path', 255)->nullable();
            $t->string('invoice_file_name', 160)->nullable();
            $t->string('eway_no', 40)->nullable();
            $t->string('eway_file_path', 255)->nullable();
            $t->string('eway_file_name', 160)->nullable();

            $t->decimal('taxable_total', 15, 2)->default(0);
            $t->decimal('total_cgst', 15, 2)->default(0);
            $t->decimal('total_sgst', 15, 2)->default(0);
            $t->decimal('total_igst', 15, 2)->default(0);
            $t->decimal('grand_total', 15, 2)->default(0);

            $t->enum('document_type', ['domestic', 'international'])->default('domestic');
            $t->char('currency_code', 3)->nullable();
            $t->decimal('exchange_rate', 12, 6)->nullable();

            $t->unsignedSmallInteger('stage_completed')->default(1);
            $t->enum('status', ['draft', 'mapped', 'grn_pending', 'closed', 'cancelled'])->default('draft');
            $t->unsignedBigInteger('warehouse_id')->nullable()->index();

            $t->string('zoho_bill_id', 64)->nullable();
            $t->string('zoho_bill_number', 64)->nullable();
            $t->string('zoho_status', 20)->nullable();
            $t->text('zoho_error')->nullable();
            $t->timestamp('zoho_synced_at')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->unique(['client_id', 'branch_id', 'code']);
            $t->unique(['client_id', 'vendor_id', 'invoice_no']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_supplier_invoices');
    }
};
