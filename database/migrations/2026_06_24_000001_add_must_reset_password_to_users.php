<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HRMS-BUG-010 — "login allowed with old password after employee email change".
 *
 * Changing the login email is an identity-level change, so the old password
 * must not keep working. We flag the user as `must_reset_password` when their
 * email is changed; login is then refused (with a "reset first" message) until
 * they set a new password through the Forgot Password / change-password flow,
 * which clears the flag.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('must_reset_password')->default(false)->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('must_reset_password');
        });
    }
};
