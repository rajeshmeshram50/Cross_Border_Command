<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->timestamp('rehired_at')->nullable()->after('completed_at');
            $table->unsignedBigInteger('rehired_by')->nullable()->after('rehired_at');
            $table->boolean('rehire_restart_onboarding')->default(false)->after('rehired_by');
            $table->string('rehire_note', 500)->nullable()->after('rehire_restart_onboarding');

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
