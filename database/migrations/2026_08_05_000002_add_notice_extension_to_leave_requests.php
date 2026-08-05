<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Notice-period leave policy — unpaid leave taken while serving notice pushes
 * the last working day out by the same number of days (the notice period has
 * to be actually served, so a day not worked is a day added).
 *
 * The number of days THIS request pushed the exit out is recorded on the
 * request itself rather than only mutating employee_exits.last_working_day.
 * Without it the extension is irreversible: cancelling an approved unpaid
 * leave would have no way to know how much of the current last working day
 * belonged to it, and repeated approve/cancel cycles would drift the exit date
 * further out every time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->unsignedSmallInteger('notice_extension_days')->nullable()->after('days');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropColumn('notice_extension_days');
        });
    }
};
