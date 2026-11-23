<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->json('clearances')->nullable()->after('replacement_required');
            $table->json('asset_returns')->nullable()->after('clearances');
            $table->text('handover_notes')->nullable()->after('asset_returns');

            $table->json('validation')->nullable()->after('handover_notes');
            $table->string('final_employee_status', 20)->nullable()->after('validation');
            $table->string('profile_lock', 20)->nullable()->after('final_employee_status');
            $table->string('exit_case_status', 20)->default('Open')->after('profile_lock');
            $table->string('hr_sign_off', 20)->nullable()->after('exit_case_status');

            $table->json('stage_status')->nullable()->after('hr_sign_off');
            $table->unsignedTinyInteger('current_stage')->default(1)->after('stage_status');
            $table->timestamp('completed_at')->nullable()->after('current_stage');

            $table->index('exit_case_status');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['exit_case_status']);
            $table->dropColumn([
                'clearances', 'asset_returns', 'handover_notes',
                'validation', 'final_employee_status', 'profile_lock',
                'exit_case_status', 'hr_sign_off',
                'stage_status', 'current_stage', 'completed_at',
            ]);
        });
    }
};
