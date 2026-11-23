<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_tnc_library', function (Blueprint $table) {
            $table->string('segment', 1024)->default('General')->change();
            $table->string('regulatory', 16)->default('highly')->after('segment');
        });
    }

    public function down(): void
    {
        Schema::table('clm_tnc_library', function (Blueprint $table) {
            $table->dropColumn('regulatory');
            $table->string('segment', 64)->default('General')->change();
        });
    }
};
