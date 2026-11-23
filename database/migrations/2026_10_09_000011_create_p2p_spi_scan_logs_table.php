<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_scan_logs', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable();

            $t->unsignedBigInteger('supplier_invoice_id')->nullable();
            $t->unsignedBigInteger('putaway_id')->nullable();
            $t->unsignedBigInteger('box_id')->nullable();

            $t->enum('scan_type', ['box', 'location', 'rack', 'shelf']);
            $t->string('scanned_value', 120);
            $t->unsignedBigInteger('resolved_id')->nullable();

            $t->enum('result', ['success', 'failed']);
            $t->enum('failure_reason', [
                'unknown_code', 'wrong_spi', 'out_of_order', 'shelf_not_on_rack',
                'already_placed', 'inactive_location', 'duplicate_scan', 'no_spi_context',
            ])->nullable();
            $t->text('message')->nullable();
            $t->enum('expected_scan', ['box', 'location', 'rack', 'shelf'])->nullable();

            $t->unsignedBigInteger('device_id')->nullable();
            $t->string('device_serial', 64)->nullable();
            $t->unsignedBigInteger('scanned_by')->nullable();
            $t->unsignedInteger('latency_ms')->nullable();

            $t->timestamp('scanned_at');

            $t->index(['supplier_invoice_id', 'scanned_at']);
            $t->index(['device_id', 'scanned_at']);
        });

        DB::statement(
            "CREATE INDEX idx_spi_scan_failed ON p2p_spi_scan_logs (scanned_at) WHERE result = 'failed'"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_scan_logs');
    }
};
