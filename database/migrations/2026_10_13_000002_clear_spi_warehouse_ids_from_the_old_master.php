<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $orphans = DB::table('p2p_supplier_invoices')
            ->whereNotNull('warehouse_id')
            ->whereNotIn('warehouse_id', fn ($q) => $q->select('id')->from('inventory_warehouses'))
            ->pluck('code', 'id');

        if ($orphans->isEmpty()) return;

        DB::table('p2p_supplier_invoices')
            ->whereIn('id', $orphans->keys())
            ->update(['warehouse_id' => null]);

        DB::table('p2p_spi_putaways')
            ->whereIn('supplier_invoice_id', $orphans->keys())
            ->delete();
    }

    public function down(): void
    {
    }
};
