<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Intraday punch ledger — one row per tap (clock-in / step-out / lunch / etc).
 *
 * Replaces the previous "one row = one day with check_in_at + check_out_at"
 * pattern. The parent `attendances` row now acts as a daily summary
 * (check_in_at = first 'in', check_out_at = last 'out') while the actual
 * timeline lives here. Strictly alternating direction is enforced server-side
 * so the timeline can never go from 'in → in' or 'out → out'.
 *
 * Total worked seconds = sum of (out_at − in_at) over paired punches; computed
 * on the fly via an accessor on Attendance, no separate column needed.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('attendance_punches', function (Blueprint $table) {
            $table->id();

            $table->foreignId('attendance_id')->constrained('attendances')->cascadeOnDelete();
            // Denormalised so list/report queries can skip the join. Same
            // pattern as `attendances.client_id` / `attendances.branch_id`.
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();

            $table->timestamp('punched_at')->index();

            // The two semantics any punch must carry: which way the employee
            // is going (in vs out) and a human-readable activity label.
            $table->enum('direction', ['in', 'out']);

            // Free-ish text — frontend picks from a known set ('Check In',
            // 'Step Out', 'Step In', 'Lunch Out', 'Lunch In', 'Meeting',
            // 'Check Out') but we store as varchar to allow custom labels
            // for one-off events without a schema change.
            $table->string('label', 50)->default('Check In');

            $table->enum('method', ['face', 'manual', 'auto'])->default('face');

            // Audit trail — match distance lets HR investigate suspicious
            // late-night punches. Lat/lng + IP captured per-punch since
            // location can change across a single day's punches.
            $table->decimal('match_distance', 5, 4)->nullable();
            $table->string('ip', 64)->nullable();
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();

            $table->text('notes')->nullable();

            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_punches');
    }
};
