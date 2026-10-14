<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · The box has been handed to the warehouse floor for Zebra verification.
 *
 * Stage 04 offers two ways to confirm a placement, and they do not end in the
 * same place. Manual Confirmation COMPLETES NOW — the operator says the box is
 * on the shelf and the put-away is done. The Zebra option CREATES A SCAN TASK:
 * the box leaves the screen, sits in a queue, and is closed by a handheld that
 * may be offline for hours. A row that outlives the request that made it is a
 * work item, and work items need their own table.
 *
 * NOT the same thing as p2p_spi_scan_logs. That logs every ATTEMPT, good and
 * bad, and always will. This is the OUTSTANDING WORK. "Did anyone scan this?"
 * and "what is still open on the floor?" are different questions and one table
 * cannot answer both — the first needs every row ever written, the second needs
 * only the handful that are still pending.
 *
 * TWO SCANS, IN ORDER. The box QR first; the shelf QR stays locked until it
 * verifies. Scanning the shelf first would prove only that the operator stood
 * in front of a shelf, which is not what is being attested.
 *
 * Capacity is already held by the occupancy row this task points at — it was
 * reserved when the location was assigned, before the task existed. The task
 * does not reserve anything; it confirms what was reserved.
 */
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

            // ZT-YYYYMMDD-NNN, numbered per branch like every other code here.
            $t->string('task_code', 30);

            /* The address the task EXPECTS. Kept on the task rather than read
               from the put-away row, because what the operator was TOLD to scan
               is the thing a mismatch has to be judged against — and the
               put-away row can be re-assigned while a task is open. */
            $t->unsignedBigInteger('warehouse_id');
            $t->unsignedBigInteger('zone_id');
            $t->unsignedBigInteger('rack_id')->nullable();
            $t->unsignedBigInteger('shelf_id')->nullable();

            // 2 in a racked zone (box + shelf), 2 in a no-rack zone (box + zone).
            $t->unsignedSmallInteger('required_scans')->default(2);
            $t->unsignedSmallInteger('completed_scans')->default(0);
            $t->timestamp('box_scan_at')->nullable();
            $t->timestamp('shelf_scan_at')->nullable();

            $t->string('status', 12)->default('pending');
            // What the modal prints: "CAPACITY RESERVED 12.9% of SH-105".
            $t->decimal('capacity_reserved_pct', 6, 2)->nullable();

            $t->timestamp('issued_at')->nullable();
            $t->unsignedBigInteger('issued_by')->nullable();
            /* Which handheld answered. The serial is kept beside the id so an
               unregistered unit still records what scanned, as the put-away row
               and attendance_punches both already do. */
            $t->unsignedBigInteger('device_id')->nullable();
            $t->string('device_serial', 64)->nullable();

            $t->timestamp('completed_at')->nullable();
            $t->timestamp('cancelled_at')->nullable();
            $t->unsignedBigInteger('cancelled_by')->nullable();
            $t->string('failed_reason', 120)->nullable();
            /* Without a deadline an unanswered task is indistinguishable from
               one nobody has got to yet, and the box sits unverified forever. */
            $t->timestamp('expires_at')->nullable();

            /* issued_by raised the task and cancelled_by closed it; these are
               who touched the row, which is a different question once a
               supervisor or a scheduled reaper edits somebody else's task. */
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();

            $t->timestamps();

            $t->unique(['client_id', 'branch_id', 'task_code'], 'p2p_spi_putaway_tasks_code_unique');
        });

        DB::statement(
            "alter table p2p_spi_putaway_tasks add constraint putaway_task_status_check
             check (status in ('pending','scanned','failed','cancelled','expired'))"
        );

        /* One open task per box. A second one would be a second instruction to
           place the same box, and the two could name different shelves. */
        DB::statement(
            "create unique index uq_putaway_task_open_box on p2p_spi_putaway_tasks
             (box_id) where status = 'pending'"
        );
        // The floor's queue: small, read constantly, and only ever the pending ones.
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
