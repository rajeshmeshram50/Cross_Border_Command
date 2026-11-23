<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->decimal('late_lop_days', 6, 2)->nullable()->after('lop_days');
        });
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropColumn('late_lop_days');
        });
    }
};
