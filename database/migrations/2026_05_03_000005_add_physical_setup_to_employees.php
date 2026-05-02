<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stage 3 — Physical Setup & Identification.
 *
 * Three small fields that the wizard tracks alongside device
 * allocation: biometric enrolment, desk/workstation slot, and ID card
 * print status. All nullable so existing rows stay valid; all default
 * to the "not yet" state shown in the UI when blank.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('biometric_status', 50)->nullable()->after('other_master_asset_ids');
            $table->string('desk_workstation_no', 50)->nullable()->after('biometric_status');
            $table->string('id_card_status', 50)->nullable()->after('desk_workstation_no');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn([
                'biometric_status',
                'desk_workstation_no',
                'id_card_status',
            ]);
        });
    }
};
