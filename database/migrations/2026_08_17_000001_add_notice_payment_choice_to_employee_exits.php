<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->string('notice_payment_choice', 10)
                ->nullable()
                ->after('notice_settlement_mode');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropColumn('notice_payment_choice');
        });
    }
};
