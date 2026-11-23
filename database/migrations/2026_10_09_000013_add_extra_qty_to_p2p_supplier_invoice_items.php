<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_supplier_invoice_items', function (Blueprint $t) {
            $t->decimal('extra_qty', 14, 3)->default(0)->after('po_line_total');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_supplier_invoice_items', function (Blueprint $t) {
            $t->dropColumn('extra_qty');
        });
    }
};
