<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · SPI audit trail — what was done to this invoice, in order.
 *
 * Answers "what happened first, then what": created, items saved, boxes packed,
 * stickers printed, scans, put-away confirmed, submitted. The fulfilment ledger
 * says what a change did to the PO's pending quantity; this says what a PERSON
 * did to the invoice.
 *
 * `event` is left as a plain string rather than an enum: the list grows as
 * stages are built, and an enum would need a migration for each new verb on a
 * table whose values are never branched on in SQL.
 *
 * Append-only: performed_at only, no updated_at and no deleted_at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_activities', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable();

            $t->unsignedBigInteger('supplier_invoice_id');
            // NULL for header-level events.
            $t->unsignedBigInteger('supplier_invoice_item_id')->nullable();
            // Set for Stage 03 / 04 events.
            $t->unsignedBigInteger('box_id')->nullable();
            $t->unsignedSmallInteger('stage')->nullable();     // 1-4, so the timeline can group by stage

            /* created · stage1_saved · invoice_uploaded · eway_uploaded
               item_added · item_updated · item_removed
               box_created · box_updated · box_deleted · packed · unpacked
               sticker_printed · storage_type_set
               box_scanned · rack_scanned · shelf_scanned · putaway_confirmed
               submitted · cancelled · zoho_synced · zoho_failed */
            $t->string('event', 40);

            $t->string('field', 40)->nullable();               // which field changed, for the *_updated events
            $t->text('old_value')->nullable();
            $t->text('new_value')->nullable();
            $t->decimal('quantity', 14, 3)->nullable();        // for packing / unpacking events
            $t->text('note')->nullable();                      // the submit note, a hold reason

            $t->unsignedBigInteger('performed_by')->nullable();
            // When it happened, not when the row was written.
            $t->timestamp('performed_at');

            // The timeline is always read for one invoice in time order.
            $t->index(['supplier_invoice_id', 'performed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_activities');
    }
};
