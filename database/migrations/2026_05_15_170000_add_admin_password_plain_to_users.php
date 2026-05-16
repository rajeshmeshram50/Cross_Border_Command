<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds an encrypted-but-reversible mirror of the user's password so the
 * Super Admin can read it back when editing a Client (the regular
 * `password` column stays bcrypt-hashed for actual auth). Encryption uses
 * `Crypt::encryptString()` which keys off `APP_KEY` — anyone with DB
 * + APP_KEY access can decrypt, so treat both as sensitive.
 *
 * Column is nullable so existing users (created before this migration)
 * simply show an empty password field on edit — admin can re-set it.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('password_encrypted')->nullable()->after('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('password_encrypted');
        });
    }
};
