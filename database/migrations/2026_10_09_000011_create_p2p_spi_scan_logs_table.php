<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Scan log — every put-away scan ATTEMPT, success and failure.
 *
 * p2p_spi_putaways holds the outcome; this holds the attempts. A scan that was
 * rejected — wrong box, out of order, unreadable barcode — never touches the
 * put-away table, so without this row it is invisible. That is what turns
 * "the scanner isn't working" into an answerable question.
 *
 * This table grows per TAP, not per document, and is by far the
 * fastest-growing table in the module. Agree a retention rule (prune old
 * successes, keep failures) before it reaches tens of millions of rows;
 * pruning loses no business state, because the outcome lives in
 * p2p_spi_putaways.
 *
 * Append-only: scanned_at only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_scan_logs', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable();

            // NULL when a barcode is scanned with no invoice open.
            $t->unsignedBigInteger('supplier_invoice_id')->nullable();
            // NULL when the attempt failed before any put-away row existed.
            $t->unsignedBigInteger('putaway_id')->nullable();
            // NULL when the barcode did not resolve to a box.
            $t->unsignedBigInteger('box_id')->nullable();

            $t->enum('scan_type', ['box', 'location', 'rack', 'shelf']);
            // The raw string the scanner reported, stored even when unreadable
            // — that string IS the evidence.
            $t->string('scanned_value', 120);
            $t->unsignedBigInteger('resolved_id')->nullable();   // NULL on failure

            $t->enum('result', ['success', 'failed']);
            $t->enum('failure_reason', [
                'unknown_code', 'wrong_spi', 'out_of_order', 'shelf_not_on_rack',
                'already_placed', 'inactive_location', 'duplicate_scan', 'no_spi_context',
            ])->nullable();
            // The exact text shown to the operator, so a complaint can be reproduced.
            $t->text('message')->nullable();
            // What the flow was waiting for — this is what makes an
            // out-of-order failure diagnosable.
            $t->enum('expected_scan', ['box', 'location', 'rack', 'shelf'])->nullable();

            $t->unsignedBigInteger('device_id')->nullable();
            $t->string('device_serial', 64)->nullable();
            $t->unsignedBigInteger('scanned_by')->nullable();
            $t->unsignedInteger('latency_ms')->nullable();       // server round-trip, for judging the TC27 pilot

            $t->timestamp('scanned_at');

            $t->index(['supplier_invoice_id', 'scanned_at']);
            $t->index(['device_id', 'scanned_at']);
        });

        /* Failures are the only rows anyone queries in bulk, and they are the
           minority — a partial index keeps that lookup small however far the
           table grows. Laravel's builder cannot express WHERE. */
        DB::statement(
            "CREATE INDEX idx_spi_scan_failed ON p2p_spi_scan_logs (scanned_at) WHERE result = 'failed'"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_scan_logs');
    }
};
