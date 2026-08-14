<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rule 8 — a canonical employment type.
 *
 * PF eligibility has been deciding "is this person full-time?" by looking for
 * the substring "full" in `work_type`, a free-text column the form writes
 * verbatim. Live data already holds both "Full-time" and "Full Time" for the
 * same thing, and the substring test also treats a BLANK work_type as
 * full-time — so a half-filled employee record silently attracted PF.
 *
 * This adds `employee_type` with a closed vocabulary, backfilled from whatever
 * `work_type` happens to say. `work_type` is deliberately left in place: it is
 * shown on the employee form and referenced elsewhere, and dropping it would be
 * a wider change than this rule needs. `employee_type` becomes the column
 * payroll and the payroll export read.
 *
 * Rows whose work_type is blank or unrecognised are left NULL rather than
 * guessed at, and PayrollService keeps treating NULL as PF-eligible so no
 * existing payslip moves — the difference is that the ambiguity is now visible
 * in a column HR can filter and fix.
 */
return new class extends Migration
{
    /** work_type (lower-cased, punctuation-stripped) => canonical type. */
    private const MAP = [
        'fulltime'   => 'Full-time',
        'full'       => 'Full-time',
        'permanent'  => 'Full-time',
        'parttime'   => 'Part-time',
        'part'       => 'Part-time',
        'contract'   => 'Contract',
        'contractual'=> 'Contract',
        'intern'     => 'Intern',
        'internship' => 'Intern',
        'trainee'    => 'Intern',
        'consultant' => 'Consultant',
        'consulting' => 'Consultant',
        'freelance'  => 'Consultant',
    ];

    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('employee_type', 30)->nullable()->after('work_type')->index();
        });

        foreach (DB::table('employees')->whereNotNull('work_type')->get(['id', 'work_type']) as $row) {
            $key = preg_replace('/[^a-z]/', '', strtolower((string) $row->work_type));
            $type = self::MAP[$key] ?? null;
            if ($type !== null) {
                DB::table('employees')->where('id', $row->id)->update(['employee_type' => $type]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('employee_type');
        });
    }
};
