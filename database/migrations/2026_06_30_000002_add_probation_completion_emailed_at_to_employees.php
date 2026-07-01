<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Tracks when the "Probation Successfully Completed" email was sent to an
     * employee, so the daily job never sends it twice.
     */
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->timestamp('probation_completion_emailed_at')->nullable()->after('probation_months');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('probation_completion_emailed_at');
        });
    }
};
