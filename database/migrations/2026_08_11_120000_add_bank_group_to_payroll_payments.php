<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_payments', function (Blueprint $table) {
            $table->string('bank_group', 16)->default('all')->after('mode');
        });

        \Illuminate\Support\Facades\DB::table('payroll_payments')
            ->whereNull('bank_group')->update(['bank_group' => 'all']);
    }

    public function down(): void
    {
        Schema::table('payroll_payments', function (Blueprint $table) {
            $table->dropColumn('bank_group');
        });
    }
};
