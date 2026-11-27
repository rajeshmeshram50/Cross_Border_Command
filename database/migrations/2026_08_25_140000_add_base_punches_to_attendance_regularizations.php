<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            $table->json('base_punches')->nullable()->after('punches');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            $table->dropColumn('base_punches');
        });
    }
};
