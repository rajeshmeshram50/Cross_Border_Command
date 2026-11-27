<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('department_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->unsignedBigInteger('department_id');
            $table->foreignId('module_id')->constrained('modules')->cascadeOnDelete();

            $table->boolean('can_view')->default(false);
            $table->boolean('can_add')->default(false);
            $table->boolean('can_edit')->default(false);
            $table->boolean('can_delete')->default(false);
            $table->boolean('can_export')->default(false);
            $table->boolean('can_import')->default(false);
            $table->boolean('can_approve')->default(false);

            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'department_id', 'module_id'], 'dept_perm_unique');
            $table->index(['client_id', 'department_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('department_permissions');
    }
};
