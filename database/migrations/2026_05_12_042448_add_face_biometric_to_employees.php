<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Face-biometric columns on the employees row.
 *
 * Stores the 128-d descriptor that face-api.js computes on the SPA. Plain JSON
 * array of floats — small enough (~1.5 KB) to live on the row itself, and easy
 * to read back into a JS Float32Array for distance comparison at clock-in.
 *
 * Consent columns are kept separately so the audit trail survives even after
 * the user revokes their biometric (we wipe the descriptor + the registered_at
 * timestamp on revoke, but keep `consent_given_at` and `consent_revoked_at` so
 * a future regulator query has a paper trail).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->json('face_descriptor')->nullable()->after('biometric_status');
            $table->timestamp('face_registered_at')->nullable()->after('face_descriptor');
            $table->timestamp('face_consent_given_at')->nullable()->after('face_registered_at');
            $table->timestamp('face_consent_revoked_at')->nullable()->after('face_consent_given_at');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn([
                'face_descriptor',
                'face_registered_at',
                'face_consent_given_at',
                'face_consent_revoked_at',
            ]);
        });
    }
};
