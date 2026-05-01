<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Track which step of the Add Employee wizard has been saved. The wizard
 * now persists incrementally — each Next click PATCHes the row and bumps
 * this counter. On Edit the modal resumes at `wizard_step_completed + 1`,
 * so a candidate who filled steps 1-3 lands on step 4 next time.
 *
 * Range: 0 (no save yet — interim transitional state) … 4 (fully filled).
 * Even at 4 the employee stays in the Disabled list until an admin
 * explicitly flips status to 'Active' — the wizard captures only half
 * the data we eventually want.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->unsignedTinyInteger('wizard_step_completed')->default(0)->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('wizard_step_completed');
        });
    }
};
