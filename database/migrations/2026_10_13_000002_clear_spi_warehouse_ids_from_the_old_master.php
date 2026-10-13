<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * P2P · Drop SPI warehouse ids that pointed at master_warehouse_master.
 *
 * The SPI was written on 9 Oct against the generic Masters warehouse table,
 * because that was the only one there was. The Inventory masters arrived on
 * 10 Oct with their own tables, the Temporary Storage picker was wired to
 * inventory_warehouses, and the relation was never switched over — so an id
 * chosen from one table was read back out of the other. Nothing linked them
 * and the ids do not line up, so a saved value named a different warehouse
 * than the one picked, silently, whenever a row happened to share the number.
 *
 * The relation now reads inventory_warehouses. Any id already stored was
 * allocated from the OLD table and means nothing in the new one: it either
 * resolves to nothing, or — worse — to an unrelated warehouse that happens to
 * share the id. There is no mapping to migrate, because the two sets were
 * never the same warehouses.
 *
 * So the stale ones are cleared rather than guessed at. Null is the honest
 * state — "no warehouse chosen yet" — and it is what both isOwnWarehouse()
 * and isFullPutaway() already treat as the full rack-and-shelf flow, which is
 * the behaviour those invoices had while the id was being misread. Stage 4
 * asks for the warehouse again, and this time it is stored against the table
 * the picker lists.
 *
 * Only ids with no match are touched: one that already names a real Inventory
 * warehouse is correct and left alone.
 */
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

        // The put-away row carries its own copy, and warehouse_id is NOT NULL
        // there — a row whose warehouse cannot be resolved cannot be confirmed,
        // so it goes with the id it was built from. Empty on every environment
        // this has run on so far; written for the one where it is not.
        DB::table('p2p_spi_putaways')
            ->whereIn('supplier_invoice_id', $orphans->keys())
            ->delete();
    }

    /** Irreversible: the old id is gone and there is nothing to map it back to. */
    public function down(): void
    {
    }
};
