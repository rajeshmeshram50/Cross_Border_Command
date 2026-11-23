<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_audit_logs')) return;

        Schema::create('credvault_audit_logs', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id');
            $t->unsignedBigInteger('branch_id')->nullable();
            $t->unsignedBigInteger('user_id')->nullable()->index();
            $t->string('action', 20);
            $t->string('severity', 10)->default('info');
            $t->unsignedBigInteger('credential_id')->nullable()->index();
            $t->string('credential_code', 20)->nullable();
            $t->string('credential_name', 150)->nullable();
            $t->string('module', 40)->nullable();
            $t->string('detail', 500)->nullable();
            $t->json('meta')->nullable();
            $t->string('ip', 45)->nullable();
            $t->string('user_agent', 255)->nullable();
            $t->timestamp('created_at')->useCurrent();

            $t->index(['client_id', 'created_at']);
            $t->index(['client_id', 'action', 'created_at']);
            $t->index(['client_id', 'severity', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_audit_logs');
    }
};
