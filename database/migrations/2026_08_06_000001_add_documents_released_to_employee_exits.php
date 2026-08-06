<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exit Process — document release gate.
 *
 * Exit documents (relieving letter, experience certificate, NOC …) must not be
 * viewable or sent for signature until HR has decided the employee is actually
 * cleared to receive them — dues settled, assets returned, clearances in. The
 * Exit Documents stage now carries an explicit "release documents" toggle, and
 * every action on that stage is disabled until it is switched on.
 *
 * Defaults to FALSE: a case that existed before this column, or one nobody has
 * looked at yet, is closed rather than open. An accidental release can't be
 * un-sent, so the safe default is the restrictive one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->boolean('documents_released')->default(false)->after('handover_notes');
            $table->timestamp('documents_released_at')->nullable()->after('documents_released');
            $table->unsignedBigInteger('documents_released_by')->nullable()->after('documents_released_at');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropColumn(['documents_released', 'documents_released_at', 'documents_released_by']);
        });
    }
};
