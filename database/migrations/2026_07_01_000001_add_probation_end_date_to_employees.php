<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stores the probation END date so the daily hr:send-probation-emails job
     * filters on a plain indexed column instead of recomputing
     * date_of_joining + probation_months for every employee, every run.
     *
     * The value is calculated on the FRONTEND (Employee form) from the joining
     * date + probation policy and saved with the rest of the record — so it's a
     * normal nullable column, not DB-generated. NULL when there's no probation.
     * Indexed for the daily date-range lookup.
     */
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->date('probation_end_date')->nullable()->after('probation_months');
            $table->index('probation_end_date');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex(['probation_end_date']);
            $table->dropColumn('probation_end_date');
        });
    }
};
