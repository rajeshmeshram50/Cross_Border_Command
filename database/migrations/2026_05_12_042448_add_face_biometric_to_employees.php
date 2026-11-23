<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
