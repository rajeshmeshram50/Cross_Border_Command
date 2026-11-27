<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('leave_requests', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('leave_type_id')->index();
            $table->unsignedBigInteger('leave_plan_id')->nullable()->index();

            $table->date('from_date');
            $table->date('to_date');
            $table->decimal('days', 5, 2)->default(0);
            $table->enum('day_type', ['full', 'first_half', 'second_half'])->default('full');

            $table->text('reason')->nullable();
            $table->string('attachment_path', 1024)->nullable();

            $table->json('notify')->nullable();

            $table->boolean('handover_required')->default(false);
            $table->unsignedBigInteger('cover_person_id')->nullable();
            $table->text('handover_notes')->nullable();
            $table->text('critical_tasks')->nullable();
            $table->boolean('avail_on_call')->default(false);
            $table->string('emergency_number', 50)->nullable();
            $table->text('avail_note')->nullable();

            $table->enum('status', ['Pending', 'Approved', 'Rejected', 'Cancelled'])->default('Pending')->index();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('approver_comment')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_requests');
    }
};
