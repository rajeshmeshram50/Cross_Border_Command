<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
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
