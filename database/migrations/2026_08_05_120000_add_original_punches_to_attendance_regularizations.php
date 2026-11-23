<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            $table->json('original_punches')->nullable()->after('punches');
            $table->string('original_summary', 60)->nullable()->after('original_punches');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            $table->dropColumn(['original_punches', 'original_summary']);
        });
    }
};
