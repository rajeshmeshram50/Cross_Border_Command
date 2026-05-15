<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds `official_email` to the employees table.
 *
 * Stage 3 of onboarding has a "Official Email Address" input that's been
 * bound to s1.official_email for a while, but the column never existed
 * on employees, so saves silently dropped at validation and the field
 * reset to blank on every reload. Same fix pattern as blood_group:
 * column → model fillable → controller validator.
 *
 * Separate from `email` (the personal/work email used for login) — this
 * is the company-issued email assigned during provisioning (e.g.
 * "test.demo@inorbvict.com"), which is why it gets its own column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->string('official_email', 191)->nullable()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn('official_email');
        });
    }
};
