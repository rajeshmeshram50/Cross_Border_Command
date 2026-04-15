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

            // What
            $table->string('type', 50)->nullable(); // branch_user, hr_employee, document, expense, leave
            $table->string('entity_type', 100)->nullable(); // model class name (polymorphic)
            $table->unsignedBigInteger('entity_id')->nullable(); // related record id
            $table->string('title', 255)->nullable();
            $table->text('description')->nullable();
            $table->jsonb('data')->nullable(); // submitted form data
            $table->jsonb('changes')->nullable(); // before/after for edits

            // Who
            $table->foreignId('submitted_by')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();

            // Status
            $table->string('status', 20)->nullable()->default('pending'); // draft, pending, in_progress, approved, rejected, cancelled
            $table->string('priority', 20)->nullable()->default('medium'); // low, medium, high, urgent
            $table->integer('level')->nullable()->default(1); // approval level (for multi-level)

            // Comments
            $table->text('submit_comment')->nullable();
            $table->text('review_comment')->nullable();
            $table->text('approval_comment')->nullable();

            // Timestamps
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->timestamp('expires_at')->nullable(); // auto-reject after this

            $table->timestamps();

            // Indexes
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
