<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_tnc_library', function (Blueprint $table) {
            $table->string('scope', 16)->default('segment')->after('category');
            $table->index(['client_id', 'scope', 'category'], 'clm_tnc_scope_idx');
        });
    }

    public function down(): void
    {
        Schema::table('clm_tnc_library', function (Blueprint $table) {
            $table->dropIndex('clm_tnc_scope_idx');
            $table->dropColumn('scope');
        });
    }
};
