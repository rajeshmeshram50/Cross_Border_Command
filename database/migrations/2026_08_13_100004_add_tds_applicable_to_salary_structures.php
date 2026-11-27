<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_structures', function (Blueprint $table) {
            $table->boolean('tds_applicable')->default(false)->after('pt_applicable');
        });
    }

    public function down(): void
    {
        Schema::table('salary_structures', function (Blueprint $table) {
            $table->dropColumn('tds_applicable');
        });
    }
};
