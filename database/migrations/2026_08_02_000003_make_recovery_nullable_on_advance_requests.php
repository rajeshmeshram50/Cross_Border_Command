<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recovery start / mode were NOT NULL on the original advance_requests table
 * (every advance was assumed recoverable from salary). A "Company used" advance
 * carries neither — it isn't recovered — so both columns must be nullable.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->date('recovery_start')->nullable()->change();
            $table->string('recovery_mode', 16)->nullable()->change();
        });
    }

    public function down(): void
    {
        // Revert to NOT NULL. Any company advances with null values would block
        // this, so backfill a placeholder first if you ever roll back.
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->date('recovery_start')->nullable(false)->change();
            $table->string('recovery_mode', 16)->nullable(false)->change();
        });
    }
};
