<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
