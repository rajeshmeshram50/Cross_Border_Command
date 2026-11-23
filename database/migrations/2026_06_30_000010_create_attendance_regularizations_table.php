<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('attendance_regularizations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();
            $table->unsignedBigInteger('attendance_id')->nullable()->index();

            $table->date('regularization_date');
            $table->enum('mode', ['adjust', 'exempt'])->default('adjust');
            $table->string('type', 100)->nullable();

            $table->json('work_locations')->nullable();
            $table->json('punches')->nullable();

            $table->text('reason')->nullable();

            $table->enum('status', ['Pending', 'Approved', 'Rejected', 'Cancelled'])->default('Pending')->index();

            $table->json('approval_chain')->nullable();
            $table->unsignedInteger('current_approval_level')->default(1);

            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('approver_comment')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_regularizations');
    }
};
