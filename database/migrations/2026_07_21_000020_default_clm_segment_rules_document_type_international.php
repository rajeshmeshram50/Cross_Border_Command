<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        DB::table('clm_segment_rules')
            ->whereNull('document_type')
            ->update(['document_type' => 'international']);

        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->string('document_type', 16)->nullable(false)->default('international')->change();
        });
    }

    public function down(): void
    {
        Schema::table('clm_segment_rules', function (Blueprint $table) {
            $table->string('document_type', 16)->nullable()->default(null)->change();
        });
    }
};
