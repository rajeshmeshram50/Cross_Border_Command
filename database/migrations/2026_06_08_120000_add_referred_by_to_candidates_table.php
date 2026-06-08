<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Capture who referred a candidate when Source = Referral (HRMS-BUG-057).
     * Stores both the employee FK (for linking/reporting) and a name snapshot
     * so the referrer is still legible if the employee row later changes.
     */
    public function up(): void
    {
        Schema::table('candidates', function (Blueprint $table) {
            $table->unsignedBigInteger('referred_by_id')->nullable()->after('source');
            $table->string('referred_by_name', 150)->nullable()->after('referred_by_id');
        });
    }

    public function down(): void
    {
        Schema::table('candidates', function (Blueprint $table) {
            $table->dropColumn(['referred_by_id', 'referred_by_name']);
        });
    }
};
