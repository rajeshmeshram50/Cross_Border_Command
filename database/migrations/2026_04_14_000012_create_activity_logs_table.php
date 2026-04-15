<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // Action details
            $table->string('action', 100)->nullable(); // login, logout, create, update, delete, export, import
            $table->string('module', 100)->nullable(); // which module: clients, branches, users, payments
            $table->string('target_type', 100)->nullable(); // model class (polymorphic)
            $table->unsignedBigInteger('target_id')->nullable();
            $table->text('description')->nullable();

            // Change tracking
            $table->jsonb('old_values')->nullable(); // before update
            $table->jsonb('new_values')->nullable(); // after update

            // Request context
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->string('url', 500)->nullable();
            $table->string('method', 10)->nullable(); // GET, POST, PUT, DELETE

            $table->timestamp('created_at')->nullable();

            // Indexes
            $table->index('user_id');
            $table->index('client_id');
            $table->index('created_at');
            $table->index(['target_type', 'target_id']);
            $table->index('action');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
