<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lead_assignment_histories', function (Blueprint $table) {
            $table->id();

            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->foreignId('lead_id')->constrained('leads')->cascadeOnDelete();
            $table->string('opp_code', 64)->nullable();

            $table->string('action', 32);

            $table->unsignedBigInteger('assignee_user_id')->nullable();
            $table->string('assignee_name', 191)->nullable();

            $table->unsignedBigInteger('previous_user_id')->nullable();
            $table->string('previous_name', 191)->nullable();

            $table->unsignedBigInteger('assigned_by_user_id')->nullable();
            $table->string('assigned_by_name', 191)->nullable();

            $table->string('platform', 64)->nullable();
            $table->string('source', 64)->nullable();

            $table->string('description', 255)->nullable();

            $table->timestamp('created_at')->nullable();

            $table->index(['lead_id', 'created_at']);
            $table->index('client_id');
            $table->index('action');
            $table->index('assignee_user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lead_assignment_histories');
    }
};
