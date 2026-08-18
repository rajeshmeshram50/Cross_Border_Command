<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records that an employee's designation CHANGED, so promotion paperwork can be
 * offered to the people who were actually promoted.
 *
 * The gap this closes: `employees.designation_id` holds today's value and
 * nothing else. There is no history table and no audit log anywhere in the
 * schema, so "this employee was promoted from Intern to Employee" was
 * unanswerable — a promotion and a hire that started at that grade looked
 * identical. Promotion-triggered document templates could therefore only be
 * matched against the CURRENT designation, which would have offered them to
 * every employee at that grade from their first day.
 *
 * Why two columns on `employees` rather than a history table: the question
 * being asked is "was this person promoted, from what, and when" — the last
 * change answers it, and the promotion documents for the previous grade have
 * already been dealt with by the time a second promotion happens. A full
 * `employee_designation_changes` table is the better home for reporting on
 * every promotion an employee has ever had, and these columns do not prevent
 * one being added later; they just do not require it today.
 *
 * Both stay null for a new hire. Null previous_designation_id is precisely
 * "never changed grade", which is what the promotion check tests for — so the
 * default state is the safe one and no backfill is possible or wanted: we
 * cannot invent history that was never recorded, and guessing would tell HR
 * that people were promoted when they were not.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            // The grade held BEFORE the most recent change. Null = the employee
            // has held one designation since their record was created.
            $table->unsignedBigInteger('previous_designation_id')->nullable()->after('designation_id');

            // When that change was saved. Deliberately not `updated_at`, which
            // moves on any edit at all and so cannot date a promotion.
            $table->timestamp('designation_changed_at')->nullable()->after('previous_designation_id');

            $table->index('previous_designation_id');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex(['previous_designation_id']);
            $table->dropColumn(['previous_designation_id', 'designation_changed_at']);
        });
    }
};
