<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hr_custom_fields', function (Blueprint $table) {
            $table->string('used_in_hint', 500)->nullable()->after('description');
        });
    }

    public function down(): void
    {
        Schema::table('hr_custom_fields', function (Blueprint $table) {
            $table->dropColumn('used_in_hint');
        });
    }
};
