<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-branch work shifts. Stored as JSON: [{ name, start, end }, ...].
     * Feeds the Employee form's Shift dropdown so each branch runs its own
     * shift list instead of a hardcoded global one.
     */
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->json('shifts')->nullable()->after('notes');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn('shifts');
        });
    }
};
