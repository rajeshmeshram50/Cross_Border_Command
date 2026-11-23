<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedTinyInteger('onboarding_stage_completed')
                ->default(0)
                ->after('wizard_step_completed');
        });

        DB::statement('UPDATE employees SET onboarding_stage_completed = 1 WHERE wizard_step_completed >= 4 AND onboarding_stage_completed = 0');
        DB::statement('UPDATE employees SET onboarding_stage_completed = 4 WHERE stage4_completed_at IS NOT NULL AND onboarding_stage_completed < 4');
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('onboarding_stage_completed');
        });
    }
};
