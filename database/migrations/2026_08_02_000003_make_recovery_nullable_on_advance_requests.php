<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->date('recovery_start')->nullable(false)->change();
            $table->string('recovery_mode', 16)->nullable(false)->change();
        });
    }
};
