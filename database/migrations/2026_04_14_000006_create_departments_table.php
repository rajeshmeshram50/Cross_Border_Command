<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('departments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->cascadeOnDelete();

            $table->string('name', 255)->nullable();
            $table->string('code', 50)->nullable();
            $table->text('description')->nullable();
            $table->string('status', 20)->nullable()->default('active');
            $table->foreignId('head_user_id')->nullable()->constrained('users')->nullOnDelete(); // department head

            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('departments');
    }
};
