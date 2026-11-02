<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CredVault · the tenant's policy settings, one row per client.
 *
 * Stored as one json document rather than a row per key: the 17 settings are
 * always read together, and the defaults live in the model, so a key added
 * later needs no migration — a tenant without it simply reads the default.
 * Each change is recorded in credvault_audit_logs (action 'policy', with the
 * old and new value), which is the Change History screen.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_policies')) return;

        Schema::create('credvault_policies', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->unique();
            $t->json('settings');
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_policies');
    }
};
