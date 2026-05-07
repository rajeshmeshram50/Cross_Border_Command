<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stores recent password hashes per user so we can prevent re-use of the
 * last N passwords on reset / change. NIST SP 800-63B doesn't strictly
 * require this any more (their newer guidance prefers length + breach
 * checks), but it remains the de-facto SaaS / enterprise standard and
 * customers expect it.
 *
 * Policy: keep the last 2 historical hashes per user. Combined with the
 * current password (in `users.password`), this blocks the user from
 * reusing any of their last 3 passwords.
 *
 * Pruning happens application-side (see PasswordHistory trait) — we don't
 * need a DB-level limit, so the schema stays simple.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();
            $table->string('password_hash');           // bcrypt/argon2 hash
            $table->timestamp('created_at')->useCurrent();

            // Most queries are "give me this user's recent hashes" → indexed.
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('password_histories');
    }
};
