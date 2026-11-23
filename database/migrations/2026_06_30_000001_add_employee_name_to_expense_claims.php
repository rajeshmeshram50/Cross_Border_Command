<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->string('employee_name', 255)->nullable()->after('employee_id');
        });

        DB::table('expense_claims')->orderBy('id')->chunkById(500, function ($claims) {
            foreach ($claims as $claim) {
                if (!empty($claim->employee_name) || !$claim->employee_id) {
                    continue;
                }
                $emp = DB::table('employees')->where('id', $claim->employee_id)->first();
                if (!$emp) {
                    continue;
                }
                $name = $emp->display_name
                    ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''));
                if ($name !== '') {
                    DB::table('expense_claims')->where('id', $claim->id)->update(['employee_name' => $name]);
                }
            }
        });
    }

    public function down(): void
    {
        Schema::table('expense_claims', function (Blueprint $table) {
            $table->dropColumn('employee_name');
        });
    }
};
