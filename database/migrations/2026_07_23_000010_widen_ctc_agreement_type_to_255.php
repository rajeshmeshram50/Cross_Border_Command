<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
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
