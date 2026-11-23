<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->string('shift_name', 120)->nullable()->after('status');
            $table->string('shift_start', 5)->nullable()->after('shift_name');
            $table->string('shift_end', 5)->nullable()->after('shift_start');
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn(['shift_name', 'shift_start', 'shift_end']);
        });
    }
};
