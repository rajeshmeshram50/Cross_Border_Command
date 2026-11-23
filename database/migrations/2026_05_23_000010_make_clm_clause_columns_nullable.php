<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('clm_clause_types')) {
            Schema::table('clm_clause_types', function (Blueprint $table) {
                $table->string('description', 500)->nullable()->change();
            });
        }
        if (Schema::hasTable('clm_clause_library')) {
            Schema::table('clm_clause_library', function (Blueprint $table) {
                $table->string('party', 255)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
    }
};
