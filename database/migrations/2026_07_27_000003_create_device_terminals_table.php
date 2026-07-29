<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Physical biometric terminals (eSSL / ZKTeco). One row per device.
 *
 * The registry is what makes the public /iclock push endpoint tenant-safe: a
 * device authenticates by its Serial No. (SN) only, so the SN → (client_id,
 * branch_id) binding here is the ONLY thing that decides which tenant a pushed
 * punch belongs to. Unknown / inactive serials are acknowledged but NOT
 * ingested.
 *
 * See docs/ESSL_ATTENDANCE_INTEGRATION.md §14.4, §17, §26.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('device_terminals', function (Blueprint $table) {
            $table->id();

            // Tenant binding — a terminal lives at one branch of one client.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // eSSL Serial No. (Menu → System → Device Info). The device's identity.
            $table->string('serial', 64)->unique();
            $table->string('name', 100)->nullable();

            // The device clock's timezone — punches arrive in this local time and
            // are converted to UTC on ingest. India devices default to IST.
            $table->string('timezone', 64)->default('Asia/Kolkata');

            // Reserved for a future signed-push scheme (Mode C hardening).
            $table->string('ingest_token', 80)->nullable();

            $table->boolean('is_active')->default(true);
            $table->timestamp('last_seen_at')->nullable();

            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_terminals');
    }
};
