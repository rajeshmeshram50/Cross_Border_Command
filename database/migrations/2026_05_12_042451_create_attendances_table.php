<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Attendance ledger — one row per (employee, calendar date).
 *
 * `check_in_method` lets us mix methods on the same table later (manual fallback,
 * geo-fence, RFID, etc.). For now only `face` and `manual` are populated.
 * `match_distance` is the Euclidean distance between the captured descriptor
 * and the enrolled one — kept on the row so audits / disputes can reconstruct
 * how confident the match was (face-api thresholds ~0.5–0.6).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('attendances', function (Blueprint $table) {
            $table->id();

            // Tenancy stamps — denormalised onto every row so list/scoping
            // queries don't have to join to employees on every read.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

            // Calendar date this row belongs to. Indexed because every UI
            // ("today's attendance", "this week", "month summary") filters by
            // date range first.
            $table->date('attendance_date')->index();

            // Punch timestamps. Both nullable because clock-out happens later
            // than clock-in (and may never happen for "Missing Out").
            $table->timestamp('check_in_at')->nullable();
            $table->timestamp('check_out_at')->nullable();

            $table->enum('check_in_method',  ['face', 'manual', 'auto'])->default('face')->nullable();
            $table->enum('check_out_method', ['face', 'manual', 'auto'])->default('face')->nullable();

            // Face-match audit trail. Lower = closer (better) match.
            $table->decimal('check_in_match_distance', 5, 4)->nullable();
            $table->decimal('check_out_match_distance', 5, 4)->nullable();

            $table->string('check_in_ip', 64)->nullable();
            $table->string('check_out_ip', 64)->nullable();
            $table->decimal('check_in_lat',  10, 7)->nullable();
            $table->decimal('check_in_lng',  10, 7)->nullable();
            $table->decimal('check_out_lat', 10, 7)->nullable();
            $table->decimal('check_out_lng', 10, 7)->nullable();

            // Derived status — populated server-side from shift policy. For
            // the MVP we set Present on check-in and let HR override later.
            $table->enum('status', [
                'Present', 'Late', 'Half Day', 'Missing In', 'Missing Out',
                'Weekly Off', 'Holiday', 'On Duty', 'Work From Home',
                'Absent', 'Leave', 'Corrected',
            ])->default('Present');

            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();

            // One row per (employee, date) so a second clock-in on the same
            // day updates the same row instead of creating duplicates.
            $table->unique(['employee_id', 'attendance_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendances');
    }
};
