<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('permissions', function (Blueprint $table) {
            $table->id();

            // Who - one of these will be set based on scope
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->cascadeOnDelete();
            $table->string('role', 50)->nullable(); // client_admin, branch_manager, staff, viewer

            // What
            $table->foreignId('module_id')->nullable()->constrained('modules')->cascadeOnDelete();

            // CRUD permissions
            $table->boolean('can_view')->nullable()->default(false);
            $table->boolean('can_add')->nullable()->default(false);
            $table->boolean('can_edit')->nullable()->default(false);
            $table->boolean('can_delete')->nullable()->default(false);
            $table->boolean('can_export')->nullable()->default(false);
            $table->boolean('can_import')->nullable()->default(false);
            $table->boolean('can_approve')->nullable()->default(false);

            // Granted by
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            // Indexes
            $table->index(['client_id', 'role']);
            $table->index('user_id');
            $table->index('module_id');
            $table->index('branch_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('permissions');
    }
};
