<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Agreement Type on CTC contracts was capped at 64 chars (both the DB column
     * and the API validation), but the CLM agreement library uses 255. Widen the
     * column to match so longer agreement-type names save.
     */
    public function up(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->string('agreement_type', 255)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('ctc_contracts', function (Blueprint $table) {
            $table->string('agreement_type', 64)->nullable()->change();
        });
    }
};
