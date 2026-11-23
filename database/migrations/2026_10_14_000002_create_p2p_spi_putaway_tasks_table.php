<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('p2p_spi_putaway_tasks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('supplier_invoice_id')->index();
            $t->unsignedBigInteger('putaway_id')->index();
            $t->unsignedBigInteger('box_id');
            $t->unsignedBigInteger('occupancy_id')->nullable();

            $t->string('task_code', 30);

            $t->unsignedBigInteger('warehouse_id');
            $t->unsignedBigInteger('zone_id');
            $t->unsignedBigInteger('rack_id')->nullable();
            $t->unsignedBigInteger('shelf_id')->nullable();

            $t->unsignedSmallInteger('required_scans')->default(2);
            $t->unsignedSmallInteger('completed_scans')->default(0);
            $t->timestamp('box_scan_at')->nullable();
            $t->timestamp('shelf_scan_at')->nullable();

            $t->string('status', 12)->default('pending');
            $t->decimal('capacity_reserved_pct', 6, 2)->nullable();

            $t->timestamp('issued_at')->nullable();
            $t->unsignedBigInteger('issued_by')->nullable();
            $t->unsignedBigInteger('device_id')->nullable();
            $t->string('device_serial', 64)->nullable();

            $t->timestamp('completed_at')->nullable();
            $t->timestamp('cancelled_at')->nullable();
            $t->unsignedBigInteger('cancelled_by')->nullable();
            $t->string('failed_reason', 120)->nullable();
            $t->timestamp('expires_at')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();

            $t->timestamps();

            $t->unique(['client_id', 'branch_id', 'task_code'], 'p2p_spi_putaway_tasks_code_unique');
        });

        DB::statement(
            "alter table p2p_spi_putaway_tasks add constraint putaway_task_status_check
             check (status in ('pending','scanned','failed','cancelled','expired'))"
        );

        DB::statement(
            "create unique index uq_putaway_task_open_box on p2p_spi_putaway_tasks
             (box_id) where status = 'pending'"
        );
        DB::statement(
            "create index idx_putaway_task_open on p2p_spi_putaway_tasks
             (branch_id, status) where status = 'pending'"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_spi_putaway_tasks');
    }
};
