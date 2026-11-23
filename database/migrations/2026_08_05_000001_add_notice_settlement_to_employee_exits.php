<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->string('notice_settlement_mode', 20)->nullable()->after('replacement_required');

            $table->unsignedSmallInteger('notice_days_required')->nullable()->after('notice_settlement_mode');
            $table->unsignedSmallInteger('notice_days_served')->nullable()->after('notice_days_required');
            $table->unsignedSmallInteger('notice_days_unserved')->nullable()->after('notice_days_served');

            $table->string('notice_settlement_basis', 10)->nullable()->after('notice_days_unserved');
            $table->decimal('notice_per_day_rate', 12, 2)->nullable()->after('notice_settlement_basis');
            $table->decimal('notice_settlement_amount', 12, 2)->nullable()->after('notice_per_day_rate');

            $table->string('notice_settlement_status', 20)->nullable()->after('notice_settlement_amount');

            $table->json('notice_payment')->nullable()->after('notice_settlement_status');

            $table->json('fnf')->nullable()->after('notice_payment');

            $table->index('notice_settlement_status');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['notice_settlement_status']);
            $table->dropColumn([
                'notice_settlement_mode',
                'notice_days_required',
                'notice_days_served',
                'notice_days_unserved',
                'notice_settlement_basis',
                'notice_per_day_rate',
                'notice_settlement_amount',
                'notice_settlement_status',
                'notice_payment',
                'fnf',
            ]);
        });
    }
};
