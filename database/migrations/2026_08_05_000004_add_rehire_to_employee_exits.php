<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exit Process — rehire.
 *
 * A rehired employee has to read as ACTIVE again, but their exit is history
 * worth keeping: what they resigned for, when they left, what was settled.
 * So the exit row is NOT deleted — it's stamped as rehired, and every reader
 * that asks "is this person exited?" treats a stamped row as spent.
 *
 * `rehire_restart_onboarding` records whether HR chose to put them back
 * through onboarding (to refresh bank details, address, documents) rather than
 * simply switching the login back on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->timestamp('rehired_at')->nullable()->after('completed_at');
            $table->unsignedBigInteger('rehired_by')->nullable()->after('rehired_at');
            $table->boolean('rehire_restart_onboarding')->default(false)->after('rehired_by');
            $table->string('rehire_note', 500)->nullable()->after('rehire_restart_onboarding');

            // The list filters on this constantly — "show me everyone whose
            // exit is still live" is the Exited tab's whole query.
            $table->index('rehired_at');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['rehired_at']);
            $table->dropColumn(['rehired_at', 'rehired_by', 'rehire_restart_onboarding', 'rehire_note']);
        });
    }
};
