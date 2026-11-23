<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vendor_currency_locks', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->index();
            $table->unsignedBigInteger('branch_id')->nullable();
            $table->unsignedBigInteger('vendor_id');
            $table->string('supplier_code', 40)->nullable();
            $table->json('po_ids')->nullable();
            $table->json('po_codes')->nullable();
            $table->string('currency_code', 8);
            $table->enum('zoho_synced', ['yes', 'no'])->default('no');
            $table->timestamps();

            $table->unique(['client_id', 'vendor_id'], 'vcl_client_vendor_unique');
        });

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
