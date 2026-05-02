<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drop the audit-trail table — the Broadcast Centre no longer surfaces an
 * audit panel, and we don't want a write-only sink dangling on the schema.
 * The original create-announcements migration was also pruned so fresh
 * installs never create this table in the first place.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('announcement_audit_logs');
    }

    public function down(): void
    {
        // Re-create the bare-minimum shape if rollback is ever needed,
        // matching the original schema we just dropped.
        Schema::create('announcement_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('announcement_id')->index();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('action', 30);
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['announcement_id', 'created_at']);
        });
    }
};
