<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Zoho Books pins every contact to ONE currency for life, and refuses any
 * transaction in another — "the customer's currency and the currency used in
 * this transaction are different". A supplier we had traded with in two
 * currencies therefore had its second purchase order rejected at sync.
 *
 * One row per supplier: the currency it trades in, and every purchase order
 * raised in that currency listed alongside it. `zoho_synced` turns yes as soon
 * as ANY of those orders reaches Zoho Books — from that point the currency is
 * final, because the books cannot be made to forget it.
 *
 * A PO in a different currency is never added here; Stage 01 refuses it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_currency_locks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->index();
            $table->unsignedBigInteger('branch_id')->nullable();
            $table->unsignedBigInteger('vendor_id');
            // Carried alongside the ids so the row still reads on its own.
            $table->string('supplier_code', 40)->nullable();
            // Every PO raised on this supplier in this currency, oldest first.
            $table->json('po_ids')->nullable();
            $table->json('po_codes')->nullable();
            $table->string('currency_code', 8);
            $table->enum('zoho_synced', ['yes', 'no'])->default('no');
            $table->timestamps();

            $table->unique(['client_id', 'vendor_id'], 'vcl_client_vendor_unique');
        });

        /* Backfill from the purchase orders that already exist. A currency already
           in Zoho Books outranks one that never left here, since the books cannot
           be made to forget it; otherwise the earliest PO settles the supplier.
           Orders in any other currency are deliberately left out — they are the
           conflict this table exists to surface. */
        $pos = DB::table('p2p_purchase_orders as po')
            ->leftJoin('vendors as v', 'v.id', '=', 'po.vendor_id')
            ->whereNull('po.deleted_at')
            ->whereNotNull('po.vendor_id')
            ->orderBy('po.id')
            ->get(['po.id', 'po.code', 'po.client_id', 'po.branch_id', 'po.vendor_id',
                'po.currency_code', 'po.zoho_status', 'v.vendor_code']);

        $byVendor = [];
        foreach ($pos as $po) {
            $byVendor[$po->client_id . ':' . $po->vendor_id][] = $po;
        }

        $rows = [];
        foreach ($byVendor as $group) {
            $ccy = fn ($p) => strtoupper(trim((string) ($p->currency_code ?: 'INR')));
            // The synced one decides when there is one, else the earliest.
            $anchor = null;
            foreach ($group as $p) {
                if ($p->zoho_status === 'synced') { $anchor = $p; break; }
            }
            $anchor ??= $group[0];
            $currency = $ccy($anchor);

            $matching = array_values(array_filter($group, fn ($p) => $ccy($p) === $currency));
            $rows[] = [
                'client_id'     => $anchor->client_id,
                'branch_id'     => $anchor->branch_id,
                'vendor_id'     => $anchor->vendor_id,
                'supplier_code' => $anchor->vendor_code,
                'po_ids'        => json_encode(array_map(fn ($p) => (int) $p->id, $matching)),
                'po_codes'      => json_encode(array_map(fn ($p) => $p->code, $matching)),
                'currency_code' => $currency,
                'zoho_synced'   => collect($matching)->contains(fn ($p) => $p->zoho_status === 'synced') ? 'yes' : 'no',
                'created_at'    => now(),
                'updated_at'    => now(),
            ];
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('vendor_currency_locks')->insert($chunk);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('vendor_currency_locks');
    }
};
