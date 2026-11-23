<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->string('regulatory', 16)->default('less')->after('party');
            $table->string('segment')->nullable()->after('regulatory');
        });
    }

    public function down(): void
    {
        Schema::table('clm_trade_doc_library', function (Blueprint $table) {
            $table->dropColumn(['regulatory', 'segment']);
        });
    }
};
