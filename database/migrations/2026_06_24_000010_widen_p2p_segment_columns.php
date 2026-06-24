<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Map Supplier "New Supplier" Segment field became multi-select, so the
 * stored value is now a comma-joined list (e.g. "Mechanical, Electrical, …").
 *
 * Widen the segment columns 128 → 512 so several segments fit without silent
 * truncation (or a strict-mode insert error). Affects both the P2P supplier
 * directory (p2p_suppliers) and the per-product mapping snapshot
 * (p2p_sourcing_product_suppliers).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_suppliers', function (Blueprint $table) {
            $table->string('segment', 512)->nullable()->change();
        });
        Schema::table('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->string('segment', 512)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('p2p_suppliers', function (Blueprint $table) {
            $table->string('segment', 128)->nullable()->change();
        });
        Schema::table('p2p_sourcing_product_suppliers', function (Blueprint $table) {
            $table->string('segment', 128)->nullable()->change();
        });
    }
};
