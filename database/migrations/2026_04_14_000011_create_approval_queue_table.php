<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approval_queue', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->foreignId('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            $table->string('type', 50)->nullable();
            $table->string('entity_type', 100)->nullable();
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('title', 255)->nullable();
            $table->text('description')->nullable();
            $table->jsonb('data')->nullable();
            $table->jsonb('changes')->nullable();

            $table->foreignId('submitted_by')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('status', 20)->nullable()->default('pending');
            $table->string('priority', 20)->nullable()->default('medium');
            $table->integer('level')->nullable()->default(1);

            $table->text('submit_comment')->nullable();
            $table->text('review_comment')->nullable();
            $table->text('approval_comment')->nullable();

            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->timestamp('expires_at')->nullable();

            $table->timestamps();

            $table->index(['client_id', 'status']);
            $table->index('submitted_by');
            $table->index(['entity_type', 'entity_id']);
            $table->index('type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_queue');
    }
};
