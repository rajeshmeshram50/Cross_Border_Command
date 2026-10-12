<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Temporary put-away — Stage 04. Where each box rests before final binning.
 *
 * One row per box, and a box is in one place at a time, hence the unique on
 * box_id. The four scan timestamps are the chain the operator must follow:
 * box -> location -> rack -> shelf. Until confirmed_at is set the box is
 * PICKED BUT NOT PLACED — that distinction is what the Digital Warehouse view
 * reads.
 *
 * Own warehouse  -> the full chain, rack and shelf allocated
 * Third party    -> summary only; zone/rack/shelf stay NULL. The own/3PL split
 *                   is read from master_warehouse_master.wh_type, not stored.
 *
 * Carries client_id and branch_id because the put-away screen is queried in its
 * own right, across invoices.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_putaways', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('supplier_invoice_id')->index();
            $t->unsignedBigInteger('box_id');

            $t->unsignedBigInteger('warehouse_id')->index();
            $t->unsignedBigInteger('zone_id')->nullable();
            $t->unsignedBigInteger('rack_id')->nullable();
            $t->unsignedBigInteger('shelf_id')->nullable();
            $t->string('destination', 120)->nullable();      // WH-001 / Z-03 / R-14 / S-56

            $t->timestamp('box_scanned_at')->nullable();
            $t->timestamp('location_scanned_at')->nullable();
            $t->timestamp('rack_scanned_at')->nullable();
            $t->timestamp('shelf_scanned_at')->nullable();

            /* The handheld that did the scanning. device_terminals is today the
               ATTENDANCE terminal master — it needs a `kind` column before it
               serves both, or a warehouse scanner master of its own. The raw
               serial is kept alongside the id so an unregistered handheld still
               records which unit scanned, as attendance_punches already does. */
            $t->unsignedBigInteger('device_id')->nullable()->index();
            $t->string('device_serial', 64)->nullable();
            $t->unsignedBigInteger('scanned_by')->nullable();

            $t->timestamp('confirmed_at')->nullable();
            $t->unsignedBigInteger('confirmed_by')->nullable();
            // Damage noticed AT THE RACK — a later moment than the condition
            // recorded while unpacking in Stage 03.
            $t->enum('condition_at_putaway', ['perfect', 'minor', 'major', 'severe'])->nullable();

            $t->timestamps();
            $t->softDeletes();

            $t->unique('box_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_putaways');
    }
};
