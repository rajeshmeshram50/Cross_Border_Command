<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_activities', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable();

            $t->unsignedBigInteger('supplier_invoice_id');
            $t->unsignedBigInteger('supplier_invoice_item_id')->nullable();
            $t->unsignedBigInteger('box_id')->nullable();
            $t->unsignedSmallInteger('stage')->nullable();

            $t->string('event', 40);

            $t->string('field', 40)->nullable();
            $t->text('old_value')->nullable();
            $t->text('new_value')->nullable();
            $t->decimal('quantity', 14, 3)->nullable();
            $t->text('note')->nullable();

            $t->unsignedBigInteger('performed_by')->nullable();
            $t->timestamp('performed_at');

            $t->index(['supplier_invoice_id', 'performed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_activities');
    }
};
