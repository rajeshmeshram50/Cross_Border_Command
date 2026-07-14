<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Make / Brand / Specifications must accept unlimited text (QA-32) — the
 * original column was varchar(255). Widen it to TEXT so long make/brand/spec
 * strings save without truncation. Description + confidential_info are already
 * TEXT and unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->text('brand')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('brand', 255)->nullable()->change();
        });
    }
};
