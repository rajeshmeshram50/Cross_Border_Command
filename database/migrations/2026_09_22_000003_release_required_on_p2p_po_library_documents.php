<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Stage 04: only the Purchase Order is required outright. Whether a trade
 * document or an agreement has to be signed for an order is decided on the
 * screen (Necessary / Not necessary), so rows seeded from the CLM libraries
 * must not arrive already marked mandatory.
 *
 * Touches only library-sourced rows; the Purchase Order row keeps is_required.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('p2p_purchase_order_documents')
            ->whereNotNull('source_type')
            ->where('is_required', 'yes')
            ->update(['is_required' => 'no']);
    }

    public function down(): void
    {
        // The library flag that set these is gone, so there is nothing faithful
        // to restore — leaving them decidable is the safe direction.
    }
};
