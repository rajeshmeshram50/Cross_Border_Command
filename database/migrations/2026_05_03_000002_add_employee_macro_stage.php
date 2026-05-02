<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Macro-stage watermark for the 6-stage onboarding flow.
 *
 *   0 = nothing completed yet
 *   1 = Stage 1 (Setup wizard) fully done
 *   2 = Stage 2 (Document Management) done
 *   3 = Stage 3 (Provisioning & Asset Setup) done
 *   4 = Stage 4 (Payroll & Finance Setup) done
 *   5 = Stage 5 (Policies & Agreements) done
 *   6 = Stage 6 (Final Verification & Activation) done
 *
 * The existing `wizard_step_completed` column tracks Stage 1's INTERNAL
 * 4-step progress and stays load-bearing — this column adds the macro
 * dimension so profile% can span all six stages, not just Stage 1.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedTinyInteger('onboarding_stage_completed')
                ->default(0)
                ->after('wizard_step_completed');
        });

        // Backfill: any row that finished Stage 1's internal wizard
        // (wizard_step_completed >= 4) gets credited with macro stage 1.
        DB::statement('UPDATE employees SET onboarding_stage_completed = 1 WHERE wizard_step_completed >= 4 AND onboarding_stage_completed = 0');
        // Stage 4 has its own completion stamp — credit those rows too.
        DB::statement('UPDATE employees SET onboarding_stage_completed = 4 WHERE stage4_completed_at IS NOT NULL AND onboarding_stage_completed < 4');
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('onboarding_stage_completed');
        });
    }
};
