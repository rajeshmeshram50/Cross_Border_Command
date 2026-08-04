<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Settle" — for a COMPANY-used advance that has been fully paid out, the
 * employee who took it marks it as settled once they've accounted for the
 * company-paid amount. This is a status (a timestamp), not an amount
 * reconciliation. Null = not settled yet.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->timestamp('employee_settled_at')->nullable()->after('settled_at');
            $table->text('employee_settle_note')->nullable()->after('employee_settled_at');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['employee_settled_at', 'employee_settle_note']);
        });
    }
};
